// @ts-check
/**
 * ccusage-cn 端到端集成测试
 *
 * 验证 CLI 端到端流程：二进制解析 → 上游执行 → 输出转换
 * 通过 CCUSAGE_CNY_RATE 固定汇率，不依赖网络（per D-04）
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// ESM 兼容的 __dirname 替代方案
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = resolve(__dirname, '../bin/cli.js');

/**
 * 创建带有固定汇率的 execSync 选项
 *
 * @param {Partial<import('node:child_process').ExecSyncOptions>} [overrides] - 额外选项覆盖
 * @returns {import('node:child_process').ExecSyncOptions}
 */
function execOptions(overrides = {}) {
  return {
    env: { ...process.env, CCUSAGE_CNY_RATE: '7.0' },
    encoding: 'utf-8',
    timeout: 10000,
    ...overrides,
  };
}

describe('ccusage-cn 端到端集成测试', () => {
  it('--help 输出正常不崩溃', () => {
    const output = execSync(`node ${CLI_PATH} --help`, execOptions());
    expect(output).toBeTruthy();
  });

  it('-b 命令不因 JavaScript 错误崩溃', { timeout: 20000 }, () => {
    // 注意：上游可能返回非零退出码（如没有账单数据）
    // 此处仅验证进程不因 Node.js 运行时错误崩溃
    try {
      execSync(`node ${CLI_PATH} -b`, execOptions());
    } catch (e) {
      // 允许上游返回非零退出码，但不应有 Node.js 运行时错误
      expect(/** @type {import('node:child_process').ExecSyncError} */ (e).stderr).toBeFalsy();
    }
  });

  it('退出码正确传播（--help 返回 0）', () => {
    const result = execSync(`node ${CLI_PATH} --help`, execOptions());
    // 执行成功即退出码为 0
    expect(result).toBeTruthy();
  });

  it('环境变量 CCUSAGE_CNY_RATE 生效（控制台无网络错误）', { timeout: 20000 }, () => {
    try {
      const result = execSync(`node ${CLI_PATH} -b`, execOptions());
      // 输出中不应包含网络错误相关痕迹
      expect(result).not.toContain('fetch');
      expect(result).not.toContain('ENOTFOUND');
    } catch (e) {
      // 即使命令失败，stderr 也不应有网络错误关键词
      const stderr = /** @type {import('node:child_process').ExecSyncError} */ (e).stderr || '';
      expect(stderr).not.toContain('fetch');
      expect(stderr).not.toContain('ENOTFOUND');
      expect(stderr).not.toContain('timeout');
    }
  });
});
