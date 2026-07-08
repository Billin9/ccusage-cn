#!/usr/bin/env node
// @ts-check
/**
 * ccusage-cn CLI 主入口
 *
 * 集成所有模块的端到端包装器流程：
 * 1. 解析 CLI 参数（逐字转发上游，per D-09）
 * 2. 检测 --json 标志选择转换模式（per D-06）
 * 3. 解析上游二进制路径（per D-03）
 * 4. 按模式获取汇率：JSON/缓冲模式按日期，流式模式统一汇率
 * 5. spawn 上游进程，pipe stdout 通过 Transform stream
 * 6. 信号转发和退出码传播
 */
import process from 'node:process';
import { getExchangeRate, getExchangeRateForDate } from '../src/exchange-rate.js';
import {
  createTextTransform,
  createJsonTransform,
  createBufferedTextTransform,
} from '../src/output-transform.js';
import { resolveBinary } from '../src/binary-resolver.js';
import { createSpawner, createExitHandler } from '../src/spawner.js';
import { loadCnPricing } from '../src/pricing/cn-provider.js';

/**
 * 主流程
 *
 * @returns {Promise<void>}
 */
async function main() {
  // a. 获取 CLI 参数，逐字转发（per D-09）
  const args = process.argv.slice(2);

  // b. 检测模式（per D-06）
  const isHelp = args.includes('--help') || args.includes('-h');
  const isJson = args.includes('--json') && !isHelp;

  // c. 环境变量汇率（用于判断是否可走流式分支）
  const envRateRaw = process.env.CCUSAGE_CNY_RATE;
  const hasEnvRate = !!(envRateRaw && /^\d+(\.\d+)?$/.test(envRateRaw));

  // c2. 非帮助模式时异步加载中国模型定价（并发执行，不阻塞主流程）
  /** @type {Promise<{ version: string; models: Record<string, unknown> } | null> | null} */
  let cnPricingPromise = null;
  if (!isHelp) {
    cnPricingPromise = loadCnPricing().catch(() => null);
  }

  // d. 解析上游二进制路径
  const { command, args: cmdArgs } = await resolveBinary(args);

  // e. 创建 spawn 进程
  const { child, cleanup } = createSpawner(command, cmdArgs);

  // f. 管道转换 stdout
  /** @type {Promise<void> | null} */
  let drainPromise = null;

  if (isJson) {
    // JSON 模式：缓冲 → 按日期汇率 → 追加 exchangeRate 字段
    const [fallbackRate, cnPricing] = await Promise.all([
      getExchangeRate(),
      cnPricingPromise ?? Promise.resolve(null),
    ]);
    const getRateForDate = (/** @type {string} */ date) =>
      getExchangeRateForDate(date, fallbackRate);
    const transform = createJsonTransform(getRateForDate, fallbackRate, cnPricing);
    child.stdout.pipe(transform).pipe(process.stdout);

    // 等待异步 flush 完成（JSON transform 在 flush 中 fetch 汇率）
    drainPromise = new Promise((resolve) => {
      transform.on('end', () => setImmediate(resolve));
    });
  } else if (isHelp || hasEnvRate) {
    // 流式模式：帮助输出或用户显式设定统一汇率
    const rate = hasEnvRate
      ? parseFloat(/** @type {string} */ (envRateRaw))
      : await getExchangeRate();
    // cnPricing 在流式模式中仅用于签名一致性（见 createTextTransform JSDoc 说明）
    const cnPricing = cnPricingPromise ? await cnPricingPromise : null;
    child.stdout.pipe(createTextTransform(rate, cnPricing)).pipe(process.stdout);
    // 流式模式无需等待（同步 flush）
  } else {
    // 缓冲模式：多日期文本表格 → 按日期汇率 → 脚注
    const [currentRate, cnPricing] = await Promise.all([
      getExchangeRate(),
      cnPricingPromise ?? Promise.resolve(null),
    ]);
    const getRateForDate = (/** @type {string} */ date) =>
      getExchangeRateForDate(date, currentRate);
    const transform = createBufferedTextTransform(getRateForDate, currentRate, cnPricing);
    child.stdout.pipe(transform).pipe(process.stdout);

    // 等待异步 flush 完成（缓冲 transform 在 flush 中 fetch 多个历史汇率）
    drainPromise = new Promise((resolve) => {
      transform.on('end', () => setImmediate(resolve));
    });
  }

  // g. 设置退出处理器（传入 drainPromise 确保异步转换完成后再退出）
  createExitHandler(child, cleanup, drainPromise);

  // stderr 透传：spawn 时已设为 'inherit'（per D-10），不需额外处理
  // stdin 透传：spawn 时 stdio[0] = 'inherit'，自动透传（per D-04）
}

// 错误边界：捕获未预期的同步异常
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
