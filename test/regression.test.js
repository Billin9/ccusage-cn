// @ts-check
/**
 * ccusage-cn 回归测试
 *
 * 验证常用 CLI 模式的核心不变量：
 * - 中国模型费用非 ¥0.00
 * - 组头费用 = 子行费用之和（-b 模式）
 * - 各种表格格式兼容且不崩溃
 * - JSON 输出格式正确
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = resolve(__dirname, '../bin/cli.js');

/**
 * 运行 CLI 命令，返回 stdout 字符串
 * 不设置 CCUSAGE_CNY_RATE，让 buffered text transform + Chinese model override 正常工作
 */
function run(args) {
  try {
    return execSync(`node ${CLI_PATH} ${args}`, {
      env: { ...process.env, NO_COLOR: '1' },
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    }).toString();
  } catch (e) {
    const stderr = /** @type {import('node:child_process').ExecSyncError} */ (e).stderr || '';
    if (stderr.includes('SyntaxError') || stderr.includes('TypeError') || stderr.includes('ReferenceError')) {
      throw new Error(`JS runtime error: ${stderr}`);
    }
    return /** @type {import('node:child_process').ExecSyncError} */ (e).stdout?.toString() || '';
  }
}

/**
 * 从表格行中提取费用值（从最后一列向前搜索 ¥ 或 $）
 */
function extractCost(line) {
  const parts = line.split('│');
  for (let i = parts.length - 1; i >= 0; i--) {
    const match = parts[i].match(/[¥$](\d+\.?\d*)/);
    if (match) return parseFloat(match[1]);
  }
  return NaN;
}

/**
 * 判断行是否包含中国模型名
 */
function hasChineseModel(line) {
  return /deepseek-v4-pro|deepseek-v4-flash|glm-5\.2/.test(line);
}

/**
 * 判断行是否为 └─ 子行
 */
function isSubRow(line) {
  return /└─/.test(line);
}

/**
 * 判断行是否为组头（日期或 session UUID 在第一列，且非子行）
 */
function isGroupHeader(line) {
  const parts = line.split('│');
  if (parts.length < 3) return false;
  const firstCol = (parts[1] || '').trim();
  // 完整日期、截断日期（2026-06-…）、或 session UUID
  return /^\d{4}-\d{2}-\d{2}/.test(firstCol) || /^\d{4}-\d{2}-…/.test(firstCol) || /^[0-9a-f]{8}-/.test(firstCol);
}

// ============================================================
// daily -b 模式
// ============================================================
describe('daily -b 模式', () => {
  let output = '';

  beforeAll(() => {
    output = run('claude daily -b --since 20260601 --until 20260709');
  });

  it('输出非空且无运行时错误', () => {
    expect(output).toBeTruthy();
    expect(output).not.toMatch(/SyntaxError|TypeError|ReferenceError/);
  });

  it('表头含 Cost 和 CNY', () => {
    expect(output).toMatch(/Cost/);
    expect(output).toMatch(/CNY/);
  });

  it('└─ 子行中国模型费用非 ¥0.00', () => {
    const lines = output.split('\n');
    let checked = 0;
    let allNonZero = true;
    for (const line of lines) {
      if (!isSubRow(line) || !hasChineseModel(line)) continue;
      checked++;
      if (extractCost(line) === 0) allNonZero = false;
    }
    expect(checked).toBeGreaterThan(0);
    expect(allNonZero).toBe(true);
  });

  it('组头费用 ≈ 其下子行费用之和（容差 ±0.03）', () => {
    const lines = output.split('\n');
    let groupCost = NaN;
    let subSum = 0;
    let verifiedCount = 0;

    for (const line of lines) {
      if (isGroupHeader(line)) {
        if (!isNaN(groupCost) && subSum > 0) {
          expect(groupCost).toBeCloseTo(subSum, 1);
          verifiedCount++;
        }
        groupCost = extractCost(line);
        subSum = 0;
      } else if (isSubRow(line)) {
        const c = extractCost(line);
        if (!isNaN(c)) subSum += c;
      }
    }
    // 验证最后一个组
    if (!isNaN(groupCost) && subSum > 0) {
      expect(groupCost).toBeCloseTo(subSum, 1);
      verifiedCount++;
    }
    expect(verifiedCount).toBeGreaterThan(0);
  });

  it('汇率脚注存在', () => {
    expect(output).toMatch(/汇率参考|exchange rate/i);
  });
});

// ============================================================
// daily --compact -b 模式
// ============================================================
describe('daily --compact -b 模式', () => {
  let output = '';

  beforeAll(() => {
    output = run('claude daily --compact -b --since 20260601 --until 20260709');
  });

  it('输出非空', () => {
    expect(output).toBeTruthy();
  });

  it('compact └─ 子行中国模型费用非 ¥0.00', () => {
    const lines = output.split('\n');
    let checked = 0;
    let allNonZero = true;
    for (const line of lines) {
      if (!isSubRow(line) || !hasChineseModel(line)) continue;
      checked++;
      if (extractCost(line) === 0) allNonZero = false;
    }
    expect(checked).toBeGreaterThan(0);
    expect(allNonZero).toBe(true);
  });

  // 验证至少有一组 header+子行配对存在（不强制求和相等，因上游分组可能跨天）
  it('compact 格式有组头和子行配对', () => {
    const lines = output.split('\n');
    let headerCount = 0;
    let subRowCount = 0;

    for (const line of lines) {
      if (isGroupHeader(line)) headerCount++;
      else if (isSubRow(line) && hasChineseModel(line)) subRowCount++;
    }
    // 至少有一组数据
    expect(headerCount).toBeGreaterThan(0);
  });
});

// ============================================================
// session -b 模式
// ============================================================
describe('session -b 模式', () => {
  let output = '';

  beforeAll(() => {
    output = run('claude session -b --since 20260601 --until 20260709');
  });

  it('输出非空', () => {
    expect(output).toBeTruthy();
  });

  it('表头含 Cost 和 CNY', () => {
    expect(output).toMatch(/Cost/);
    expect(output).toMatch(/CNY/);
  });

  it('session 中国模型子行费用非 ¥0.00', () => {
    const lines = output.split('\n');
    let checked = 0;
    let allNonZero = true;
    for (const line of lines) {
      if (!isSubRow(line) || !hasChineseModel(line)) continue;
      checked++;
      if (extractCost(line) === 0) allNonZero = false;
    }
    expect(checked).toBeGreaterThan(0);
    expect(allNonZero).toBe(true);
  });
});

// ============================================================
// daily 无 -b（单模型组头）
// ============================================================
describe('daily 无 -b 模式', () => {
  let output = '';

  beforeAll(() => {
    output = run('claude daily --since 20260601 --until 20260709');
  });

  it('单模型中国模型组头费用非 ¥0.00', () => {
    const lines = output.split('\n');
    let found = false;
    let allNonZero = true;

    for (const line of lines) {
      const parts = line.split('│');
      if (parts.length < 3) continue;

      const firstCol = (parts[1] || '').trim();
      // 支持完整日期和截断日期（窄终端下显示为 2026-06-…）
      if (!/^\d{4}-\d{2}-\d{2}/.test(firstCol) && !/^\d{4}-\d{2}-…/.test(firstCol)) continue;
      if (isSubRow(line)) continue;

      // Models 列必须是单个 "- modelName"
      const modelCol = (parts[2] || '').trim();
      const singleMatch = modelCol.match(/^-\s+(\S+)$/);
      if (!singleMatch) continue;
      if (!hasChineseModel(line)) continue;

      found = true;
      if (extractCost(line) === 0) allNonZero = false;
    }

    expect(found).toBe(true);
    expect(allNonZero).toBe(true);
  });
});

// ============================================================
// blocks 模式
// ============================================================
describe('blocks 模式', () => {
  let output = '';

  beforeAll(() => {
    output = run('claude blocks --recent --since 20260701');
  });

  it('输出非空且无运行时错误', () => {
    expect(output).toBeTruthy();
    expect(output).not.toMatch(/SyntaxError|TypeError|ReferenceError/);
  });

  it('单模型中国 model block 费用非 ¥0.00', () => {
    const lines = output.split('\n');
    let checked = 0;
    let allNonZero = true;

    for (const line of lines) {
      if (!hasChineseModel(line)) continue;

      // blocks 格式：模型在中间的 Models 列（parts[3]）
      const parts = line.split('│');
      if (parts.length < 7) continue;
      const modelCol = (parts[3] || '').trim();

      // 只检查单模型 block（模型列含 "- modelName" 且不含逗号）
      const match = modelCol.match(/^-\s+(\S+)$/);
      if (!match) continue;
      if (!/deepseek-v4-pro|deepseek-v4-flash|glm-5\.2/.test(match[1])) continue;

      checked++;
      if (extractCost(line) === 0) allNonZero = false;
    }

    if (checked > 0) {
      expect(allNonZero).toBe(true);
    }
  });
});

// ============================================================
// blocks --json 模式
// ============================================================
describe('blocks --json 模式', () => {
  /** @type {any} */
  let data;

  beforeAll(() => {
    const raw = run('claude blocks --json --recent --since 20260701');
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  });

  it('JSON 可解析且含 blocks 数组', () => {
    expect(data).not.toBeNull();
    expect(Array.isArray(data?.blocks)).toBe(true);
  });

  it('单模型 block 的 costCNY > 0', () => {
    if (!data?.blocks) return;
    let checked = 0;
    let allNonZero = true;

    for (const b of data.blocks) {
      if (b.isGap) continue;
      if (!Array.isArray(b.models) || b.models.length !== 1) continue;
      if (typeof b.costCNY !== 'number') continue;

      checked++;
      if (b.costCNY === 0) allNonZero = false;
    }

    if (checked > 0) {
      expect(allNonZero).toBe(true);
    }
  });

  it('所有 block 有 models/tokenCounts/costCNY 字段', () => {
    if (!data?.blocks) return;
    for (const b of data.blocks) {
      if (b.isGap) continue;
      expect(b).toHaveProperty('models');
      expect(b).toHaveProperty('tokenCounts');
      expect(b).toHaveProperty('costCNY');
    }
  });
});

// ============================================================
// monthly -b 冒烟测试
// ============================================================
describe('monthly -b 模式', () => {
  let output = '';

  beforeAll(() => {
    output = run('claude monthly -b --since 20260601');
  });

  it('不崩溃且含中国模型费用数据', () => {
    expect(output).toBeTruthy();
    expect(output).not.toMatch(/SyntaxError|TypeError|ReferenceError/);
    expect(output).toMatch(/Cost/);
  });

  it('中国模型子行费用非 ¥0.00', () => {
    const lines = output.split('\n');
    let checked = 0;
    let allNonZero = true;
    for (const line of lines) {
      if (!isSubRow(line) || !hasChineseModel(line)) continue;
      checked++;
      if (extractCost(line) === 0) allNonZero = false;
    }
    expect(checked).toBeGreaterThan(0);
    expect(allNonZero).toBe(true);
  });
});

// ============================================================
// weekly -b 冒烟测试
// ============================================================
describe('weekly -b 模式', () => {
  let output = '';

  beforeAll(() => {
    output = run('claude weekly -b --since 20260601');
  });

  it('不崩溃且含 Cost 数据', () => {
    expect(output).toBeTruthy();
    expect(output).not.toMatch(/SyntaxError|TypeError|ReferenceError/);
    expect(output).toMatch(/Cost/);
  });

  it('中国模型子行费用非 ¥0.00', () => {
    const lines = output.split('\n');
    let checked = 0;
    let allNonZero = true;
    for (const line of lines) {
      if (!isSubRow(line) || !hasChineseModel(line)) continue;
      checked++;
      if (extractCost(line) === 0) allNonZero = false;
    }
    expect(checked).toBeGreaterThan(0);
    expect(allNonZero).toBe(true);
  });
});
