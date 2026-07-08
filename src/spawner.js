// @ts-check
/**
 * 进程管理器
 *
 * 自定义 spawn（pipe stdout）+ 信号转发 + 退出码传播。
 * 遵循 D-04（spawn + pipe stdout + inherit stderr）和 D-05（显式信号转发）。
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * 创建自定义 spawn 进程
 *
 * 使用 stdio: ['inherit', 'pipe', 'inherit'] 捕获 stdout 用于后续转换，
 * 同时保持 stdin 和 stderr 透传。注入 FORCE_COLOR=1 保留上游彩色输出。
 * 注册 SIGINT/SIGTERM 处理器显式转发到子进程，防止孤儿进程。
 *
 * @param {string} binaryPath - 上游二进制可执行文件路径
 * @param {string[]} args - 要传递给上游二进制的参数数组
 * @returns {{ child: import('node:child_process').ChildProcess; cleanup: () => void }}
 */
export function createSpawner(binaryPath, args) {
  const child = spawn(binaryPath, args, {
    stdio: ['inherit', 'pipe', 'inherit'],  // per D-04
    env: { ...process.env, FORCE_COLOR: '1' },  // per D-07
  });

  // 注册信号转发处理器（per D-05）
  const onSigint = () => {
    try { child.kill('SIGINT'); } catch { /* 子进程可能已退出 */ }
  };
  const onSigterm = () => {
    try { child.kill('SIGTERM'); } catch { /* 子进程可能已退出 */ }
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  /**
   * 清理信号处理器，避免父进程残留 handler
   * 应在子进程退出后调用
   */
  function cleanup() {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }

  return { child, cleanup };
}

/**
 * 创建退出码处理器
 *
 * 监听子进程 exit 事件，在子进程退出后清理信号处理器，
 * 并根据退出码或信号决定当前进程的退出行为。
 *
 * @param {import('node:child_process').ChildProcess} child - spawn 返回的子进程
 * @param {() => void} cleanupFn - cleanup 函数（解注册信号处理器）
 * @returns {import('node:child_process').ChildProcess} 返回 child 用于链式调用
 */
export function createExitHandler(child, cleanupFn) {
  child.on('exit', (code, signal) => {
    cleanupFn();

    if (signal !== null) {
      // 子进程被信号终止，以相同信号退出（per D-05）
      process.kill(process.pid, signal);
    } else {
      // 传播退出码（per CLI-02 和 D-10）
      process.exit(code ?? 0);
    }
  });

  return child;
}
