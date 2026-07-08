// @ts-check
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { getCacheDir, formatCNY } from './utils.js';

/** 缓存生存时间：24 小时（毫秒） */
const CACHE_TTL = 24 * 60 * 60 * 1000;

/** 硬编码默认汇率 */
const DEFAULT_RATE = 7.2;

/** CDN 汇率 API 地址 */
const RATE_API_URL =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';

/** CDN fetch 超时时间（毫秒） */
const FETCH_TIMEOUT = 5000;

/**
 * 三层汇率回退获取 USD→CNY 汇率
 *
 * 优先级：
 * 1. CCUSAGE_CNY_RATE 环境变量
 * 2. CDN API 磁盘缓存（24h TTL）
 * 3. 硬编码默认值 7.2
 *
 * @returns {Promise<number>} USD→CNY 汇率值
 */
export async function getExchangeRate() {
  // 第一层：环境变量（最高优先级）
  const envRate = process.env.CCUSAGE_CNY_RATE;
  if (envRate && /^\d+(\.\d+)?$/.test(envRate)) {
    return parseFloat(envRate);
  }

  // 第二层：CDN 缓存
  const cached = await readCache();
  if (cached !== null) {
    // 如果缓存过期，后台静默刷新，不阻塞本次输出
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      fetchAndCache().catch(() => {});
    }
    return cached.rate;
  }

  // 第三层：CDN API fetch（首次运行）
  try {
    const rate = await fetchRate();
    await cacheRate(rate);
    return rate;
  } catch {
    return DEFAULT_RATE;
  }
}

/**
 * 从磁盘读取缓存的汇率数据
 *
 * @returns {Promise<{ rate: number; timestamp: number } | null>}
 */
async function readCache() {
  const cacheFile = getCacheFilePath();
  try {
    const data = JSON.parse(await readFile(cacheFile, 'utf-8'));
    if (data && typeof data.rate === 'number' && typeof data.timestamp === 'number') {
      return { rate: data.rate, timestamp: data.timestamp };
    }
  } catch {
    // 文件不存在、格式错误等，返回 null
  }
  return null;
}

/**
 * 从 CDN API 获取实时汇率
 *
 * @returns {Promise<number>} USD→CNY 汇率
 */
async function fetchRate() {
  const response = await fetch(RATE_API_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  const data = await response.json();
  const rate = data?.usd?.cny;
  if (typeof rate !== 'number') {
    throw new TypeError('无效的汇率响应格式');
  }
  return rate;
}

/**
 * 缓存汇率到磁盘（原子写入模式）
 *
 * @param {number} rate - 要缓存的汇率值
 * @returns {Promise<void>}
 */
async function cacheRate(rate) {
  const cacheDir = getCacheDir();
  const cacheFile = getCacheFilePath();
  const tmpFile = cacheFile + '.tmp';

  await mkdir(cacheDir, { recursive: true });
  const payload = JSON.stringify({ rate, timestamp: Date.now() });
  await writeFile(tmpFile, payload, 'utf-8');
  await rename(tmpFile, cacheFile);
}

/**
 * 后台 fetch 并缓存汇率（静默失败）
 *
 * @returns {Promise<void>}
 */
async function fetchAndCache() {
  const rate = await fetchRate();
  await cacheRate(rate);
}

/**
 * 获取缓存文件完整路径
 *
 * @returns {string}
 */
function getCacheFilePath() {
  return join(getCacheDir(), 'rate.json');
}
