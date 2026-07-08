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

/**
 * 异步并发池——限制最大并发数的 Promise.all
 *
 * 无外部依赖的自实现，避免引入 p-limit。
 *
 * @template T, R
 * @param {number} concurrency - 最大并发数
 * @param {T[]} items - 要处理的元素数组
 * @param {(item: T, index: number) => Promise<R>} fn - 异步处理函数
 * @returns {Promise<R[]>} 与输入顺序一致的结果数组
 */
export async function asyncPool(concurrency, items, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  // 启动 concurrency 个 worker
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}
