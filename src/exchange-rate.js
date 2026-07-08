// @ts-check
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { getCacheDir, formatCNY } from './utils.js';

/** 缓存生存时间：24 小时（毫秒），仅适用于当天汇率 */
const CACHE_TTL = 24 * 60 * 60 * 1000;

/** 硬编码默认汇率 */
const DEFAULT_RATE = 7.2;

/** CDN 汇率 API 基础地址 */
const RATE_API_BASE =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';

/** CDN fetch 超时时间（毫秒） */
const FETCH_TIMEOUT = 5000;

/**
 * 三层汇率回退获取 USD→CNY 汇率（当前汇率）
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
  const envRate = getEnvRate();
  if (envRate !== null) return envRate;

  // 第二层：CDN 缓存
  const cached = await readCache('rate.json');
  if (cached !== null) {
    // 如果缓存过期，后台静默刷新，不阻塞本次输出
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      fetchCurrentAndCache().catch(() => {});
    }
    return cached.rate;
  }

  // 第三层：CDN API fetch（首次运行）
  try {
    const rate = await fetchCurrentRate();
    await cacheRate('rate.json', rate);
    return rate;
  } catch {
    return DEFAULT_RATE;
  }
}

/**
 * 获取指定日期的 USD→CNY 汇率（历史汇率）
 *
 * 优先级：
 * 1. CCUSAGE_CNY_RATE 环境变量（覆盖所有日期）
 * 2. 检查是否为"今天"→ 复用 getExchangeRate() 逻辑
 * 3. 磁盘缓存（历史数据不可变，无 TTL）
 * 4. CDN 历史 API fetch
 * 5. 降级到当前汇率 getExchangeRate()
 * 6. 硬编码默认值 7.2
 *
 * @param {string} dateStr - 日期字符串，格式 YYYY-MM-DD
 * @param {number} [fallbackRate] - 可选的降级汇率（避免重复 fetch）
 * @returns {Promise<number>} USD→CNY 汇率值
 */
export async function getExchangeRateForDate(dateStr, fallbackRate) {
  // 第一层：环境变量覆盖所有日期
  const envRate = getEnvRate();
  if (envRate !== null) return envRate;

  // 第二层：如果是今天，复用当前汇率逻辑
  const today = getTodayStr();
  if (dateStr === today) {
    return getExchangeRate();
  }

  // 第三层：历史汇率磁盘缓存（无 TTL，数据不可变）
  const cacheFileName = `rate-${dateStr}.json`;
  const cached = await readCache(cacheFileName);
  if (cached !== null) {
    return cached.rate;
  }

  // 第四层：CDN 历史 API fetch
  try {
    const rate = await fetchHistoricalRate(dateStr);
    // 历史汇率永久缓存（无 TTL 概念）
    await cacheRate(cacheFileName, rate);
    return rate;
  } catch {
    // 第五层：降级到当前汇率
    if (fallbackRate !== undefined) return fallbackRate;
    try {
      return await getExchangeRate();
    } catch {
      return DEFAULT_RATE;
    }
  }
}

/**
 * 解析 CCUSAGE_CNY_RATE 环境变量
 *
 * @returns {number | null} 汇率值，或 null（未设置/格式无效）
 */
function getEnvRate() {
  const envRate = process.env.CCUSAGE_CNY_RATE;
  if (envRate && /^\d+(\.\d+)?$/.test(envRate)) {
    return parseFloat(envRate);
  }
  return null;
}

/**
 * 获取今天的日期字符串 YYYY-MM-DD
 *
 * @returns {string}
 */
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 从磁盘读取缓存的汇率数据
 *
 * @param {string} fileName - 缓存文件名
 * @returns {Promise<{ rate: number; timestamp: number } | null>}
 */
async function readCache(fileName) {
  const cacheFile = join(getCacheDir(), fileName);
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
 * 从 CDN API 获取当前实时汇率
 *
 * @returns {Promise<number>} USD→CNY 汇率
 */
async function fetchCurrentRate() {
  const url = `${RATE_API_BASE}@latest/v1/currencies/usd.json`;
  const response = await fetch(url, {
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
 * 从 CDN API 获取历史汇率
 *
 * @param {string} dateStr - 日期字符串 YYYY-MM-DD
 * @returns {Promise<number>} USD→CNY 汇率
 */
async function fetchHistoricalRate(dateStr) {
  const url = `${RATE_API_BASE}@${dateStr}/v1/currencies/usd.json`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!response.ok) {
    throw new Error(`历史汇率 API 返回 ${response.status}`);
  }
  const data = await response.json();
  const rate = data?.usd?.cny;
  if (typeof rate !== 'number') {
    throw new TypeError('无效的历史汇率响应格式');
  }
  return rate;
}

/**
 * 缓存汇率到磁盘（原子写入模式）
 *
 * @param {string} fileName - 缓存文件名
 * @param {number} rate - 要缓存的汇率值
 * @returns {Promise<void>}
 */
async function cacheRate(fileName, rate) {
  const cacheDir = getCacheDir();
  const cacheFile = join(cacheDir, fileName);
  const tmpFile = cacheFile + '.tmp';

  await mkdir(cacheDir, { recursive: true });
  const payload = JSON.stringify({ rate, timestamp: Date.now() });
  await writeFile(tmpFile, payload, 'utf-8');
  await rename(tmpFile, cacheFile);
}

/**
 * 后台 fetch 当前汇率并缓存（静默失败）
 *
 * @returns {Promise<void>}
 */
async function fetchCurrentAndCache() {
  const rate = await fetchCurrentRate();
  await cacheRate('rate.json', rate);
}
