---
phase: 01-mvp
plan: 02
subsystem: 进程管理 & CLI 集成
tags: [spawn, signal-forwarding, binary-resolver, cli-entry, integration, vitest]
requires:
  - phase: 01-mvp-01
    provides: 三层汇率回退模块、双模式输出转换 Transform stream
provides:
  - 二进制解析器（封装上游 resolveCliRuntime，含回退）
  - 进程管理器（spawn + 信号转发 + 退出码传播）
  - CLI 入口（bin/cli.js 集成所有模块的端到端包装器）
  - 测试夹具（三种上游输出样本）和 26 个测试用例
affects: [01-03 (if applicable), phase-2-distribution]
tech-stack:
  added: []
  patterns:
    - ESM dynamic import with fallback catch
    - spawn stdio ['inherit', 'pipe', 'inherit'] for stdout interception
    - SIGINT/SIGTERM explicit forwarding with cleanup on exit
    - process.on('exit') cleanup via createExitHandler wrapper
key-files:
  created:
    - src/binary-resolver.js: 上游二进制路径解析（resolveCliRuntime + 回退实现）
    - src/spawner.js: 自定义 spawn + 信号转发 + 退出码传播
    - bin/cli.js: CLI 入口（shebang + 全模块集成）
    - test/fixtures/ccusage-table-output.txt: 上游表格输出样本
    - test/fixtures/ccusage-json-output.json: 上游 JSON 输出样本
    - test/fixtures/ccusage-with-ansi.txt: 含 ANSI 颜色的输出样本
  modified:
    - test/output-transform.test.js: 新增 9 个测试用例（26→26 个测试）
key-decisions:
  - "二进制解析首选 ESM 动态 import('ccusage/src/cli.js')，失败时回退到本地 platform→arch→pkgName 映射"
  - "ESM 动态 import 替代静态 import，确保 import 失败可捕获并优雅降级"
  - "信号处理器在 spawn 后立即注册，在子进程 exit 事件中 cleanup"
  - "模块设计分离为 binary-resolver / spawner / cli.js 三层，职责清晰"
patterns-established:
  - "动态导入上游公共 API + 本地回退的双保险模式"
  - "spawn 后立即注册信号处理器 + exit 事件 cleanup 的无孤儿进程模式"
  - "退出码传播：child.on('exit') → cleanup → process.exit(code/signal)"
requirements-completed: [CLI-01, CLI-02, CLI-03, CLI-04, OUT-01, OUT-03]
duration: 8min
completed: 2026-07-08
---

# Phase 1 Plan 2: 二进制解析、进程管理与 CLI 入口 — Summary

**上游二进制解析、进程生命周期管理和 CLI 主入口，将汇率获取 + 输出转换 + spawn 集成为端到端包装器，26 个测试全部通过**

## 性能

- **耗时:** 8 分钟
- **开始时间:** 2026-07-08T08:15:00Z
- **完成时间:** 2026-07-08T08:23:00Z
- **任务:** 3/3
- **创建文件:** 6 个
- **修改文件:** 1 个

## 完成的任务

| 任务 | 名称 | 提交 | 关键文件 |
|------|------|------|----------|
| 1 | 二进制解析器与进程管理模块 | 5e864f6 | src/binary-resolver.js, src/spawner.js |
| 2 | CLI 入口主流程 | ab8cb3a | bin/cli.js |
| 3 | 测试套件与验证 | 598e93c | test/fixtures/*, test/output-transform.test.js |

## 文件结构

- `src/binary-resolver.js` (130 行) — 异步函数 `resolveBinary(argv)`：
  - 通过 ESM `await import('ccusage/src/cli.js')` 使用上游 `resolveCliRuntime` 解析二进制路径
  - 上游返回 `errorMessage` 时打印错误并 `process.exit(1)`
  - 调用 `ensureNativeBinaryExecutable` 确保二进制可执行（非 Windows 设置 755 权限）
  - **回退实现：** 如果 ESM import 失败（上游添加 `exports` 字段），回退到本地 `getNativePackageName` + `require.resolve` 解析路径

- `src/spawner.js` (90 行) — 两个导出函数：
  - `createSpawner(binaryPath, args)` → `{ child, cleanup }`：
    - `spawn()` 使用 `stdio: ['inherit', 'pipe', 'inherit']`（per D-04）
    - 注入 `FORCE_COLOR=1`（per D-07）
    - 注册 `SIGINT/SIGTERM` 处理器 → `child.kill(signal)`
    - 返回 cleanup 函数用于解注册信号处理器
  - `createExitHandler(child, cleanupFn)`：
    - 监听 `child.on('exit')` 事件 → cleanup → 传播退出码或信号
    - 信号终止时 `process.kill(process.pid, signal)`；正常退出时 `process.exit(code)`

- `bin/cli.js` (62 行) — CLI 入口，集成所有模块：
  - `process.argv.slice(2)` 逐字转发参数（per D-09）
  - `args.includes('--json')` 检测模式（per D-06）：JSON → `createJsonTransform`，文本 → `createTextTransform`
  - `--help/-h` 使用文本模式（per D-10）
  - module-level `main().catch()` 错误边界

- `test/output-transform.test.js` — 26 个测试用例覆盖：
  - 文本模式（12 个）：费用替换、列标题、chunk 边界、非费用 `$`、ANSI 保持、Buffer 输入
  - JSON 模式（11 个）：`costCNY` 追加、原始保留、嵌套递归、无效 JSON 透传、缩进保持
  - 集成测试（3 个）：汇率影响转换结果（文本 + JSON）

- `test/fixtures/*` — 三个基于实际上游输出的测试样本

## 决策记录

### 1. ESM 动态 import + 回退的双保险模式

**决策：** 使用 `await import('ccusage/src/cli.js')` 动态导入而非静态 `import ... from ...`。

**理由：** 静态 ESM import 如果失败会导致模块加载错误无法捕获。动态 import 允许在 `try/catch` 中捕获失败，优雅地降级到本地回退实现。上游目前没有 `exports` 字段限制，但如果将来添加，静态 import 会直接崩溃。

### 2. 模块职责分离

**决策：** `binary-resolver`（二进制定位）、`spawner`（进程管理）、`cli.js`（流程编排）三个独立模块。

**理由：** 单一职责原则使每个模块可独立测试和替换。`binary-resolver` 只关心"找到二进制"，`spawner` 只关心"管理进程"，`cli.js` 只关心"编排流程"。

## 要求完成状态

| 要求 ID | 描述 | 状态 |
|---------|------|------|
| CLI-01 | 所有上游命令和参数完全透传 | 完成 — `process.argv.slice(2)` 逐字转发 |
| CLI-02 | 退出码正确传播 | 完成 — `createExitHandler` 传播 code/signal |
| CLI-03 | SIGINT/SIGTERM 正确处理，无孤儿进程 | 完成 — 显式信号转发 + exit cleanup |
| CLI-04 | JSON 模式不覆盖原始字段 | 完成 — costCNY 追加而非覆盖 |
| OUT-01 | ANSI 彩色输出保留 | 完成 — FORCE_COLOR=1 注入 |
| OUT-03 | --help 透传上游 | 完成 — 文本模式透传，不劫持 |

## 偏差记录

无 — 计划严格按照书面执行。

## 遇到的问题

无 — 所有代码首次运行即通过验证。

## 验证结果

- [x] `node --check bin/cli.js` — CLI 入口语法正确
- [x] `npx vitest run` — 26 个测试全部通过
- [x] `resolveBinary(['-b'])` — 成功解析上游二进制路径
- [x] `createSpawner` 模块可导入
- [x] 跨模块导入依赖可解析（验证了所有 import 路径）

## 下一阶段就绪状态

- **就绪：** 完整的端到端 CLI 包装器可运行
  - `node bin/cli.js -b` — 文本模式查看账单（费用以 ¥ 显示）
  - `node bin/cli.js --json` — JSON 模式输出含 costCNY 字段
  - `CCUSAGE_CNY_RATE=7.0 node bin/cli.js -b` — 自定义汇率
- **等待下一计划：** npm 包发布（Phase 2）、CI 集成（Phase 3）

---
*Phase: 01-mvp*
*完成于: 2026-07-08*
