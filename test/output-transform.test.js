// @ts-check
import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import {
  createTextTransform,
  createJsonTransform,
  createBufferedTextTransform,
} from '../src/output-transform.js';

/**
 * 创建一个总是返回固定汇率的 getRateForDate 回调
 *
 * @param {number} rate - 固定汇率
 * @returns {(date: string) => Promise<number>}
 */
function fixedRateProvider(rate) {
  return async (_date) => rate;
}

/**
 * 创建一个按日期返回不同汇率的回调（用于多日期测试）
 *
 * @param {Record<string, number>} rateMap - 日期→汇率映射
 * @param {number} defaultRate - 默认回退汇率
 * @returns {(date: string) => Promise<number>}
 */
function mappedRateProvider(rateMap, defaultRate = 7.2) {
  return async (date) => rateMap[date] ?? defaultRate;
}

/**
 * 将字符串通过 TextTransform 管道处理并返回结果
 *
 * @param {string} input - 输入文本
 * @param {number} rate - 汇率
 * @returns {Promise<string>} 转换后的文本
 */
function pipeThroughText(input, rate) {
  return new Promise((resolve, reject) => {
    const transform = createTextTransform(rate);
    const chunks = [];
    transform.on('data', (chunk) => chunks.push(chunk));
    transform.on('end', () => resolve(chunks.join('')));
    transform.on('error', reject);
    transform.write(input, 'utf-8');
    transform.end();
  });
}

/**
 * 通过 JSONTransform 管道处理并返回结果
 *
 * @param {string} input - 输入 JSON 字符串
 * @param {number} rate - 统一汇率
 * @returns {Promise<string>} 转换后的 JSON 字符串
 */
function pipeThroughJson(input, rate) {
  return new Promise((resolve, reject) => {
    const getRateForDate = fixedRateProvider(rate);
    const transform = createJsonTransform(getRateForDate, rate);
    const chunks = [];
    transform.on('data', (chunk) => chunks.push(chunk));
    transform.on('end', () => resolve(chunks.join('')));
    transform.on('error', reject);
    transform.write(input, 'utf-8');
    transform.end();
  });
}

/**
 * 通过 JSONTransform 管道处理（多日期模式，支持不同汇率）
 *
 * @param {string} input - 输入 JSON 字符串
 * @param {Record<string, number>} rateMap - 日期→汇率映射
 * @param {number} fallbackRate - 回退汇率
 * @returns {Promise<string>} 转换后的 JSON 字符串
 */
function pipeThroughJsonWithRates(input, rateMap, fallbackRate = 7.2) {
  return new Promise((resolve, reject) => {
    const getRateForDate = mappedRateProvider(rateMap, fallbackRate);
    const transform = createJsonTransform(getRateForDate, fallbackRate);
    const chunks = [];
    transform.on('data', (chunk) => chunks.push(chunk));
    transform.on('end', () => resolve(chunks.join('')));
    transform.on('error', reject);
    transform.write(input, 'utf-8');
    transform.end();
  });
}

/**
 * 通过 BufferedTextTransform 管道处理并返回结果
 *
 * @param {string} input - 输入文本
 * @param {Record<string, number>} rateMap - 日期→汇率映射
 * @param {number} [defaultRate=7.2] - 默认回退汇率
 * @returns {Promise<string>}
 */
function pipeThroughBufferedText(input, rateMap, defaultRate = 7.2) {
  return new Promise((resolve, reject) => {
    const getRateForDate = mappedRateProvider(rateMap, defaultRate);
    const transform = createBufferedTextTransform(getRateForDate, defaultRate);
    const chunks = [];
    transform.on('data', (chunk) => chunks.push(chunk));
    transform.on('end', () => resolve(chunks.join('')));
    transform.on('error', reject);
    transform.write(input, 'utf-8');
    transform.end();
  });
}

/**
 * 模拟 chunk 边界：将文本按指定边界分割成多个 chunk 进行流式传输
 *
 * @param {string} input - 输入文本
 * @param {number} rate - 汇率
 * @param {number[]} boundaries - 分割点索引数组
 * @returns {Promise<string>} 转换后的文本
 */
function pipeThroughTextWithChunks(input, rate, boundaries) {
  return new Promise((resolve, reject) => {
    const transform = createTextTransform(rate);
    const chunks = [];
    transform.on('data', (chunk) => chunks.push(chunk));
    transform.on('end', () => resolve(chunks.join('')));
    transform.on('error', reject);

    let prev = 0;
    for (const boundary of [...boundaries, input.length]) {
      const segment = input.slice(prev, boundary);
      transform.write(segment, 'utf-8');
      prev = boundary;
    }
    transform.end();
  });
}

// ============================================================
// createTextTransform 测试（流式，统一汇率）
// ============================================================

describe('createTextTransform', () => {
  it('测试 1: 文本模式中 $12.34 被替换为正确的 CNY 值（默认汇率 7.2）', async () => {
    const result = await pipeThroughText('$12.34', 7.2);
    expect(result).toContain('¥88.85');
    expect(result).not.toContain('$12.34');
  });

  it('测试 2: 文本模式中 $0.50 被替换为 ¥3.60', async () => {
    const result = await pipeThroughText('$0.50', 7.2);
    expect(result).toContain('¥3.60');
  });

  it('测试 3: 文本模式中 Cost (USD) 列标题被替换为 Cost (CNY)', async () => {
    const result = await pipeThroughText('Cost (USD)', 7.2);
    expect(result).toContain('Cost (CNY)');
    expect(result).not.toContain('Cost (USD)');
  });

  it('测试 3b: 独立的 (USD) 也被替换为 (CNY)（表格分行场景）', async () => {
    const result = await pipeThroughText('│    (USD) │', 7.2);
    expect(result).toContain('(CNY)');
    expect(result).not.toContain('(USD)');
  });

  it('测试 4: chunk 边界（如 "$1" 结尾、"2.34" 开头）不破坏替换', async () => {
    const input = '费用: $12.34 总计';
    const result = await pipeThroughTextWithChunks(input, 7.2, [5, 8]);
    expect(result).toContain('¥88.85');
    expect(result).not.toContain('$12.34');
  });

  it('测试 9: 非费用的 $ 符号（如路径 /dev/$project）不被转换', async () => {
    const result = await pipeThroughText('/dev/$project', 7.2);
    expect(result).toContain('/dev/$project');
  });

  it('多个费用值全部替换', async () => {
    const result = await pipeThroughText('$1.00 $2.00 $3.00', 7.2);
    expect(result).toBe('¥7.20 ¥14.40 ¥21.60');
  });

  it('非美元数字格式保持不变', async () => {
    const input = '行 1: 总计 100 个 token';
    const result = await pipeThroughText(input, 7.2);
    expect(result).toBe(input);
  });

  it('自定义汇率生效（默认为 7.0）', async () => {
    const result = await pipeThroughText('$10.00', 7.0);
    expect(result).toContain('¥70.00');
  });

  it('flush 时输出剩余的 remainder', async () => {
    const result = await pipeThroughText('剩余: $', 7.2);
    expect(result).toBe('剩余: $');
  });
});

// ============================================================
// createJsonTransform 测试（原有 + 多日期汇率）
// ============================================================

describe('createJsonTransform', () => {
  it('测试 5: JSON 模式中原始 costUSD 保留，自动追加 costCNY', async () => {
    const input = JSON.stringify({ costUSD: 12.34 });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.costUSD).toBe(12.34);
    expect(parsed.costCNY).toBe(88.85);
  });

  it('测试 6: JSON 模式中非 cost 数字字段不被追加（如 id, count）', async () => {
    const input = JSON.stringify({ id: 123, count: 5, costUSD: 10 });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe(123);
    expect(parsed.count).toBe(5);
    expect(parsed.costCNY).toBe(72);
    expect(Object.keys(parsed).length).toBe(4);
  });

  it('测试 7: JSON 模式遇到无效 JSON 时原样透传（不崩溃）', async () => {
    const input = '这不是 JSON';
    const result = await pipeThroughJson(input, 7.2);
    expect(result).toBe(input);
  });

  it('测试 8: JSON 模式保持原始缩进格式', async () => {
    const input = '{\n    "costUSD": 10\n}';
    const result = await pipeThroughJson(input, 7.2);
    expect(result).toContain('    "costUSD": 10');
    expect(result).toContain('    "costCNY": 72');
  });

  it('深度嵌套对象中的 cost 字段', async () => {
    const input = JSON.stringify({
      meta: { timestamp: '2024-01-01' },
      data: { costUSD: 50, totalCost: 100 },
    });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.data.costCNY).toBe(360);
    expect(parsed.data.totalCostCNY).toBe(720);
  });

  it('数组中的 cost 字段', async () => {
    const input = JSON.stringify([{ costUSD: 10 }, { costUSD: 20 }]);
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed[0].costCNY).toBe(72);
    expect(parsed[1].costCNY).toBe(144);
  });

  it('total_cost 和 charge 等字段名也支持', async () => {
    const input = JSON.stringify({ total_cost: 50, charge: 30, price: 20, fee: 10, spend: 5 });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.total_costCNY).toBe(360);
    expect(parsed.chargeCNY).toBe(216);
    expect(parsed.priceCNY).toBe(144);
    expect(parsed.feeCNY).toBe(72);
    expect(parsed.spendCNY).toBe(36);
  });

  it('null 和嵌套 null 不崩溃', async () => {
    const input = JSON.stringify({ costUSD: null, nested: { costUSD: null } });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.costUSD).toBeNull();
    expect(parsed.nested.costUSD).toBeNull();
  });

  // ========== 新增：多日期汇率 ==========

  it('多日期场景：每个 daily entry 使用对应日期的汇率', async () => {
    const input = JSON.stringify({
      daily: [
        { period: '2025-09-22', totalCost: 1.00, modelBreakdowns: [{ cost: 0.50, modelName: 'gpt-5' }] },
        { period: '2025-09-29', totalCost: 2.00, modelBreakdowns: [{ cost: 1.00, modelName: 'gpt-5' }] },
      ],
      summary: { totalCostUSD: 3.00 },
    });

    const result = await pipeThroughJsonWithRates(input, {
      '2025-09-22': 7.25,
      '2025-09-29': 7.30,
    });

    const parsed = JSON.parse(result);

    // 第一个日期用 7.25
    expect(parsed.daily[0].totalCostCNY).toBe(7.25);
    expect(parsed.daily[0].exchangeRate).toBe(7.25);
    expect(parsed.daily[0].modelBreakdowns[0].costCNY).toBe(3.63);
    expect(parsed.daily[0].modelBreakdowns[0].exchangeRate).toBe(7.25);

    // 第二个日期用 7.30
    expect(parsed.daily[1].totalCostCNY).toBe(14.60);
    expect(parsed.daily[1].exchangeRate).toBe(7.30);
    expect(parsed.daily[1].modelBreakdowns[0].costCNY).toBe(7.30);
    expect(parsed.daily[1].modelBreakdowns[0].exchangeRate).toBe(7.30);

    // summary 用最后一个日期的汇率
    expect(parsed.summary.totalCostCNY).toBe(21.90);
    expect(parsed.summary.exchangeRate).toBe(7.30);
  });

  it('无 daily 数组时回退到统一汇率', async () => {
    const input = JSON.stringify({ costUSD: 10, items: [{ cost: 5 }] });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.costCNY).toBe(72);
    expect(parsed.items[0].costCNY).toBe(36);
    // 无 daily 不注入 exchangeRate（仅 costCNY 追加）
  });

  it('daily entry 无有效 period 时使用 fallbackRate', async () => {
    const input = JSON.stringify({
      daily: [
        { totalCost: 1.00 },
        { period: 'invalid', totalCost: 2.00 },
      ],
      summary: { totalCostUSD: 3.00 },
    });

    const result = await pipeThroughJsonWithRates(input, {}, 7.2);
    const parsed = JSON.parse(result);

    expect(parsed.daily[0].totalCostCNY).toBe(7.20);
    expect(parsed.daily[1].totalCostCNY).toBe(14.40);
  });
});

// ============================================================
// createTextTransform - 原有新增用例
// ============================================================

describe('createTextTransform - 新增用例', () => {
  it('保持 ANSI 转义序列完整（不破坏颜色码）', async () => {
    const input = '│ \x1b[32m$6.11\x1b[0m │\n│ \x1b[32m$12.34\x1b[0m │';
    const result = await pipeThroughText(input, 7.2);
    expect(result).toContain('\x1b[32m');
    expect(result).toContain('\x1b[0m');
    expect(result).toContain('¥43.99');
    expect(result).toContain('¥88.85');
    expect(result).toMatch(/\x1b\[32m *¥43\.99\x1b\[0m/);
    expect(result).toMatch(/\x1b\[32m *¥88\.85\x1b\[0m/);
    expect(result).not.toContain('$6.11');
    expect(result).not.toContain('$12.34');
  });

  it('Buffer 类型的 chunk 正确转换', async () => {
    const result = await new Promise((resolve, reject) => {
      const transform = createTextTransform(7.2);
      const chunks = [];
      transform.on('data', (chunk) => chunks.push(chunk));
      transform.on('end', () => resolve(chunks.join('')));
      transform.on('error', reject);
      transform.write(Buffer.from('费用: $12.34', 'utf-8'));
      transform.end();
    });
    expect(result).toContain('¥88.85');
    expect(result).not.toContain('$12.34');
  });

  it('大金额 $9999.99 正确转换', async () => {
    const result = await pipeThroughText('$9999.99', 7.2);
    expect(result).toContain('¥71999.93');
  });

  it('零值 $0.00 转换为 ¥0.00', async () => {
    const result = await pipeThroughText('$0.00', 7.2);
    expect(result).toContain('¥0.00');
  });
});

// ============================================================
// createJsonTransform - 原有新增用例
// ============================================================

describe('createJsonTransform - 新增用例', () => {
  it('处理包含 costUSD、total_cost 等混合费用字段', async () => {
    const input = JSON.stringify({
      costUSD: 100,
      total_cost: 50,
      modelBreakdowns: [
        { cost: 30, modelName: 'gpt-5' },
        { cost: 20, modelName: 'gemini-2.5' },
      ],
    });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.costCNY).toBe(720);
    expect(parsed.total_costCNY).toBe(360);
    expect(parsed.modelBreakdowns[0].costCNY).toBe(216);
    expect(parsed.modelBreakdowns[1].costCNY).toBe(144);
  });

  it('空对象不崩溃', async () => {
    const result = await pipeThroughJson('{}', 7.2);
    expect(JSON.parse(result)).toEqual({});
  });

  it('空数组不崩溃', async () => {
    const result = await pipeThroughJson('[]', 7.2);
    expect(JSON.parse(result)).toEqual([]);
  });
});

// ============================================================
// createBufferedTextTransform 测试（多日期缓冲 + 脚注）
// ============================================================

describe('createBufferedTextTransform', () => {
  it('两行日期格式正确解析并分组转换', async () => {
    const input = [
      '┌──────────┬──────────┐',
      '│ Date     │     Cost │',
      '│          │    (USD) │',
      '├──────────┼──────────┤',
      '│ 2025     │    $1.00 │',
      '│ 09-22    │          │',
      '├──────────┼──────────┤',
      '│          │    $0.50 │',
      '├──────────┼──────────┤',
      '│ 2025     │    $2.00 │',
      '│ 09-29    │          │',
      '├──────────┼──────────┤',
      '│ Total    │    $3.00 │',
      '└──────────┴──────────┘',
    ].join('\n');

    const result = await pipeThroughBufferedText(input, {
      '2025-09-22': 7.25,
      '2025-09-29': 7.30,
    });

    // 第一个日期组用 7.25
    expect(result).toContain('¥7.25');  // $1.00 * 7.25
    expect(result).toContain('¥3.63');  // $0.50 * 7.25

    // 第二个日期组用 7.30
    expect(result).toContain('¥14.60'); // $2.00 * 7.30

    // Total 行用最后一个日期汇率 7.30
    expect(result).toContain('¥21.90'); // $3.00 * 7.30

    // 列标题被替换（上游表格 Cost 和 (USD) 分两行）
    expect(result).toContain('(CNY)');
    expect(result).not.toContain('(USD)');

    // 脚注存在
    expect(result).toContain('💱 汇率参考 (CNY/USD):');
    expect(result).toContain('2025-09-22: 7.2500');
    expect(result).toContain('2025-09-29: 7.3000');
  });

  it('单行日期格式正确解析', async () => {
    const input = [
      '┌────────────┬──────────┐',
      '│ Date       │     Cost │',
      '│            │    (USD) │',
      '├────────────┼──────────┤',
      '│ 2025-09-22 │    $1.00 │',
      '├────────────┼──────────┤',
      '│ 2025-09-29 │    $2.00 │',
      '├────────────┼──────────┤',
      '│ Total      │    $3.00 │',
      '└────────────┴──────────┘',
    ].join('\n');

    const result = await pipeThroughBufferedText(input, {
      '2025-09-22': 7.25,
      '2025-09-29': 7.30,
    });

    expect(result).toContain('¥7.25');
    expect(result).toContain('¥14.60');
    expect(result).toContain('💱 汇率参考 (CNY/USD):');
  });

  it('无日期信息时回退到统一汇率，不显示脚注', async () => {
    const input = '费用: $10.00\n总计: $20.00';

    const result = await pipeThroughBufferedText(input, {}, 7.2);

    // 回退：统一用 7.2
    expect(result).toContain('¥72.00');
    expect(result).toContain('¥144.00');
    // 无脚注
    expect(result).not.toContain('💱 汇率参考');
  });

  it('ANSI 颜色码在缓冲模式下保留', async () => {
    const input = [
      '│ 2025     │    \x1b[32m$6.11\x1b[0m │',
      '│ 09-29    │          │',
      '│ Total    │    \x1b[32m$6.11\x1b[0m │',
    ].join('\n');

    const result = await pipeThroughBufferedText(input, { '2025-09-29': 7.2 });

    // ANSI 序列保留
    expect(result).toContain('\x1b[32m');
    expect(result).toContain('\x1b[0m');
    // $ 被替换
    expect(result).not.toContain('$6.11');
  });

  it('>20 日期时脚注截断', async () => {
    // 构造 25 个日期的表格
    const lines = ['┌────────────┬──────────┐', '│ Date       │     Cost │', '│            │    (USD) │', '├────────────┼──────────┤'];
    /** @type {Record<string, number>} */
    const rateMap = {};
    for (let i = 1; i <= 25; i++) {
      const date = `2025-${String(Math.ceil(i / 5)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
      lines.push(`│ ${date} │    $1.00 │`);
      if (i < 25) lines.push('├────────────┼──────────┤');
      rateMap[date] = 7.0 + i * 0.01;
    }
    lines.push('│ Total      │   $25.00 │');
    lines.push('└────────────┴──────────┘');
    const input = lines.join('\n');

    const result = await pipeThroughBufferedText(input, rateMap);

    // 脚注包含截断标记
    expect(result).toContain('💱 汇率参考 (CNY/USD):');
    expect(result).toContain('...');
    expect(result).toContain('天，汇率范围');
  });
});

// ============================================================
// 集成测试：汇率值影响转换结果
// ============================================================

describe('集成: exchange-rate + output-transform', () => {
  it('汇率值影响转换结果', async () => {
    const result1 = await pipeThroughText('$10.00', 7.0);
    expect(result1).toContain('¥70.00');

    const result2 = await pipeThroughText('$10.00', 6.8);
    expect(result2).toContain('¥68.00');

    const result3 = await pipeThroughText('$10.00', 7.5);
    expect(result3).toContain('¥75.00');
  });

  it('JSON 模式下汇率影响 costCNY 值', async () => {
    const input = JSON.stringify({ costUSD: 10 });
    const result1 = await pipeThroughJson(input, 7.0);
    expect(JSON.parse(result1).costCNY).toBe(70);

    const result2 = await pipeThroughJson(input, 7.2);
    expect(JSON.parse(result2).costCNY).toBe(72);
  });

  it('多日期 JSON 模式下不同日期使用不同汇率', async () => {
    const input = JSON.stringify({
      daily: [
        { period: '2025-09-22', totalCost: 10 },
        { period: '2025-09-29', totalCost: 20 },
      ],
      summary: { totalCostUSD: 30 },
    });

    const result = await pipeThroughJsonWithRates(input, {
      '2025-09-22': 7.0,
      '2025-09-29': 7.5,
    });

    const parsed = JSON.parse(result);
    expect(parsed.daily[0].totalCostCNY).toBe(70);
    expect(parsed.daily[0].exchangeRate).toBe(7.0);
    expect(parsed.daily[1].totalCostCNY).toBe(150);
    expect(parsed.daily[1].exchangeRate).toBe(7.5);
    expect(parsed.summary.exchangeRate).toBe(7.5);
  });
});
