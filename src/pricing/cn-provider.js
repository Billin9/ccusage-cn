// @ts-check
/**
 * 中国模型人民币定价加载器
 *
 * 三层回退加载策略（per D-03）：
 * L1 — GitHub Raw fetch（在线优先）
 * L2 — 本地磁盘缓存（上次成功 fetch 的结果，24h TTL）
 * L3 — 包内捆绑文件（离线兜底）
 *
 * 任意一层成功则立即返回，不继续尝试下层。
 * 全部失败返回 null，调用方应优雅降级（per D-04）。
 *
 * @module
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCacheDir } from '../utils.js';

// --------------- 常量 ---------------

/** 定价文件包内路径（发布后位于 pricing/cn-models.json） */
const BUNDLED_FILE_PATH = '../../pricing/cn-models.json';

/** GitHub Raw 内容地址（通过 jsDelivr CDN 访问，国内可用性更好） */
const GITHUB_RAW_BASE =
  'https://cdn.jsdelivr.net/gh/Billin9/ccusage-cn@master/pricing/cn-models.json';

/** 缓存文件名 */
const CACHE_FILENAME = 'cn-pricing-cache.json';

/** fetch 超时时间（毫秒） */
const FETCH_TIMEOUT = 5000;

/** 缓存生存时间：24 小时 */
const CACHE_TTL = 24 * 60 * 60 * 1000;

// --------------- 类型验证 ---------------

/**
 * 验证定价数据对象的格式是否正确
 *
 * 检查是否包含 version(string) 和 models(object) 字段。
 *
 * @param {unknown} data - 待验证的数据
 * @returns {data is { version: string; models: Record<string, unknown> }}
 */
function isValidPricingData(data) {
  if (data === null || typeof data !== 'object') return false;
  const obj = /** @type {Record<string, unknown>} */ (data);
  return (
    typeof obj.version === 'string' &&
    obj.models !== null &&
    typeof obj.models === 'object' &&
    !Array.isArray(obj.models)
  );
}

// --------------- 读取器 ---------------

/**
 * L1 — 从 GitHub Raw 获取最新定价
 *
 * 5 秒超时，成功后写入磁盘缓存。
 *
 * @returns {Promise<{ version: string; models: Record<string, unknown> } | null>}
 */
async function fetchFromGitHub() {
  try {
    const response = await fetch(GITHUB_RAW_BASE, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!isValidPricingData(data)) return null;

    // 异步写入缓存（不阻塞返回）
    writeCache(/** @type {{ version: string; models: Record<string, unknown> }} */ (data))
      .catch(() => {});

    return data;
  } catch {
    return null;
  }
}

/**
 * L2 — 从磁盘缓存读取定价
 *
 * 检查缓存文件是否存在、格式有效、未过期。
 * 过期不阻塞（不抛错），返回 null 让上层继续尝试 L3。
 *
 * @returns {Promise<{ version: string; models: Record<string, unknown> } | null>}
 */
async function readFromCache() {
  try {
    const cacheFile = join(getCacheDir(), CACHE_FILENAME);
    const raw = await readFile(cacheFile, 'utf-8');
    const data = JSON.parse(raw);

    if (!isValidPricingData(data)) return null;

    // 检查 TTL
    const timestamp = /** @type {Record<string, unknown>} */ (data).timestamp;
    if (typeof timestamp === 'number' && Date.now() - timestamp > CACHE_TTL) {
      // 过期不阻塞，后台静默刷新
      fetchFromGitHub().catch(() => {});
      // 但过期缓存仍然可用（返回它）
    }

    const { version, models } = /** @type {{ version: string; models: Record<string, unknown>; timestamp?: number }} */ (data);
    return { version, models };
  } catch {
    return null;
  }
}

/**
 * L3 — 从包内捆绑文件读取定价（离线兜底）
 *
 * @returns {Promise<{ version: string; models: Record<string, unknown> } | null>}
 */
async function readFromBundled() {
  try {
    // 使用 import.meta.url 获取当前文件所在目录的相对路径
    const currentDir = fileURLToPath(new URL('.', import.meta.url));
    const bundledPath = join(currentDir, BUNDLED_FILE_PATH);
    const raw = await readFile(bundledPath, 'utf-8');
    const data = JSON.parse(raw);

    if (!isValidPricingData(data)) return null;

    const { version, models } = data;
    return { version, models };
  } catch {
    return null;
  }
}

// --------------- 缓存写入 ---------------

/**
 * 将定价数据写入磁盘缓存（原子写入模式）
 *
 * 写入包含 timestamp 字段用于 TTL 检查。
 *
 * @param {{ version: string; models: Record<string, unknown> }} data - 定价数据
 * @returns {Promise<void>}
 */
async function writeCache(data) {
  const { writeFile, mkdir, rename } = await import('node:fs/promises');
  const cacheDir = getCacheDir();
  const cacheFile = join(cacheDir, CACHE_FILENAME);
  const tmpFile = cacheFile + '.tmp';

  await mkdir(cacheDir, { recursive: true });
  const payload = JSON.stringify({ ...data, timestamp: Date.now() });
  await writeFile(tmpFile, payload, 'utf-8');
  await rename(tmpFile, cacheFile);
}

// --------------- 主导出 ---------------

/**
 * 三层回退加载中国模型人民币定价
 *
 * 优先级：L1 (GitHub Raw) > L2 (磁盘缓存) > L3 (捆绑文件)
 * 任一层成功则立即返回。全部失败返回 null。
 *
 * @returns {Promise<{ version: string; models: Record<string, unknown> } | null>}
 */
export async function loadCnPricing() {
  // L1 — GitHub Raw（在线优先）
  const l1 = await fetchFromGitHub();
  if (l1 !== null) return l1;

  // L2 — 磁盘缓存
  const l2 = await readFromCache();
  if (l2 !== null) return l2;

  // L3 — 包内捆绑文件（离线兜底）
  const l3 = await readFromBundled();
  if (l3 !== null) return l3;

  return null;
}
