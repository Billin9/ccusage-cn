// @ts-check
/**
 * 中国模型识别与直接 CNY 费用计算器
 *
 * 提供前缀匹配和直接 CNY 费用计算功能。
 * 中国模型使用官方人民币定价（per D-01），不走 LiteLLM USD 转换路径。
 *
 * @module
 */
import { formatCNY } from '../utils.js';

/**
 * 前缀匹配中国模型，按 key 长度降序遍历（最长匹配优先）
 *
 * 模型键名用作前缀匹配规则：
 * - `deepseek-v4-pro` 匹配 `deepseek-v4-pro`（精确）
 * - `deepseek-v4-pro` 匹配 `deepseek-v4-pro-0408`（前缀）
 * - `deepseek-v4-pro` 优先于 `deepseek` 匹配 `deepseek-v4-pro-xxx`（最长匹配优先）
 *
 * @param {string | null | undefined} modelName - 上游返回的模型名称
 * @param {Record<string, { input: number; output: number; cacheRead?: number }>} models - 中国模型定价映射
 * @returns {{ key: string; pricing: { input: number; output: number; cacheRead?: number } } | null}
 *   匹配到的模型键和定价，无匹配返回 null
 */
export function matchCnModel(modelName, models) {
  if (!modelName || !models || typeof models !== 'object') return null;

  // 按 key 长度降序排序（最长匹配优先）
  const keys = Object.keys(models).sort((a, b) => b.length - a.length);

  for (const key of keys) {
    if (modelName.startsWith(key)) {
      return { key, pricing: models[key] };
    }
  }

  return null;
}

/**
 * 直接 CNY 费用计算
 *
 * 公式：
 * cost = (inputTokens / 1_000_000) * pricing.input
 *      + (outputTokens / 1_000_000) * pricing.output
 *      + (cacheReadTokens / 1_000_000) * (pricing.cacheRead || 0)
 *
 * 所有价格单位为 CNY/百万 tokens。
 * 结果使用 formatCNY() 保留 2 位小数。
 *
 * @param {{ input: number; output: number; cacheRead?: number }} pricing - 模型定价（CNY/百万 tokens）
 * @param {number} inputTokens - 输入 token 数
 * @param {number} outputTokens - 输出 token 数
 * @param {number} [cacheReadTokens=0] - 缓存读取 token 数
 * @returns {number} 计算的 CNY 费用（保留 2 位小数）
 */
export function calcCnCost(pricing, inputTokens, outputTokens, cacheReadTokens = 0) {
  const cost =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheReadTokens / 1_000_000) * (pricing.cacheRead || 0);

  return formatCNY(cost);
}
