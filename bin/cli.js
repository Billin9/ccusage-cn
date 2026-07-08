#!/usr/bin/env node
// @ts-check
/**
 * ccusage-cn CLI 主入口
 *
 * 集成所有模块的端到端包装器流程：
 * 1. 解析 CLI 参数（逐字转发上游，per D-09）
 * 2. 检测 --json 标志选择转换模式（per D-06）
 * 3. 解析上游二进制路径（per D-03）
 * 4. 异步获取汇率（不阻塞 stdout 输出）
 * 5. spawn 上游进程，pipe stdout 通过 Transform stream
 * 6. 信号转发和退出码传播
 */
import process from 'node:process';
import { getExchangeRate } from '../src/exchange-rate.js';
import { createTextTransform, createJsonTransform } from '../src/output-transform.js';
import { resolveBinary } from '../src/binary-resolver.js';
import { createSpawner, createExitHandler } from '../src/spawner.js';

/**
 * 主流程
 *
 * @returns {Promise<void>}
 */
async function main() {
  // a. 获取 CLI 参数，逐字转发（per D-09）
  const args = process.argv.slice(2);

  // b. 检测模式（per D-06）
  // --help/-h 使用文本模式（帮助输出为纯文本）
  const isJson = args.includes('--json') && !args.includes('--help') && !args.includes('-h');

  // c. 解析上游二进制路径
  const { command, args: cmdArgs } = await resolveBinary(args);

  // d. 异步获取汇率（非阻塞，由 resolveBinary 和 spawn 之间的时间完成）
  const rate = await getExchangeRate();

  // e. 创建 spawn 进程
  const { child, cleanup } = createSpawner(command, cmdArgs);

  // f. 设置退出处理器
  createExitHandler(child, cleanup);

  // g. 管道转换 stdout
  if (isJson) {
    // JSON 模式：collect → parse → append costCNY → stringify
    child.stdout.pipe(createJsonTransform(rate)).pipe(process.stdout);
  } else {
    // 文本模式：流式逐块替换 $X.XX → ¥Y.YY
    child.stdout.pipe(createTextTransform(rate)).pipe(process.stdout);
  }

  // stderr 透传：spawn 时已设为 'inherit'（per D-10），不需额外处理
  // stdin 透传：spawn 时 stdio[0] = 'inherit'，自动透传（per D-04）
}

// 错误边界：捕获未预期的同步异常
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
