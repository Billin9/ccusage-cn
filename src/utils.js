// @ts-check
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 获取跨平台缓存目录路径
 * - Windows: %LOCALAPPDATA%/ccusage-cn/cache
 * - 其他: ~/.ccusage-cn/cache
 *
 * @returns {string} 缓存目录绝对路径
 */
export function getCacheDir() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(localAppData, 'ccusage-cn', 'cache');
  }
  return join(homedir(), '.ccusage-cn', 'cache');
}

/**
 * 格式化人民币金额，保留两位小数
 *
 * @param {number} amount - 要格式化的金额
 * @returns {number} 保留两位小数的金额
 */
export function formatCNY(amount) {
  return parseFloat(amount.toFixed(2));
}
