# Phase 1: 核心包装器 (MVP) - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

## Phase Boundary

构建零依赖 Node.js CLI 包装器，通过 `child_process.spawn()` 托管上游 ccusage 原生二进制，pipe stdout 经 `stream.Transform` 实时将美元费用（`$X.XX`）替换为人民币（`¥Y.YY`），保持 100% CLI 参数兼容。交付后可本地使用 `bunx ccusage-cn`（或 `node cli.js`）替代 `bunx ccusage`。

**本阶段范围:** 本地可运行的核心包装器（13 个需求：CLI-01~04, COST-01~04, OUT-01~03, DIST-02, UPD-01）
**不包括:** npm 发布（Phase 2）、CI 自动化（Phase 3）、实时汇率 API（v2）、双币种展示（v2）

## Implementation Decisions

### 实现技术栈
- **D-01:** 使用 Node.js 18+ ESM 编写包装器，零第三方运行时依赖。仅使用 `node:child_process`、`node:stream`、`node:process` 等内置模块。
- **D-02:** 纯 JavaScript（`.js`），不使用 TypeScript。上游 ccusage 同样使用 JS+JSDoc，保持一致性。无构建步骤，`bin` 入口直接指向 `.js` 文件。

### 二进制解析与进程管理
- **D-03:** 通过 npm 依赖 `ccusage@^20.0.0`（caret 范围），使用上游导出的 `resolveCliRuntime` 查找平台特定的原生二进制路径。这是上游 CLI 入口（`cli.js`）已使用的公开 API。
- **D-04:** 使用 `child_process.spawn()` + `stdout: 'pipe'` + `stderr: 'inherit'`，**绝不使用 `exec()` 或 `execSync()`**。避免 `maxBuffer` 限制和 shell 注入风险。
- **D-05:** 显式转发 SIGINT、SIGTERM 信号到子进程；如果子进程被信号终止，包装器以相同信号退出（`process.exit(128 + signalNumber)`）。确保 Ctrl+C 后无孤儿进程。

### 输出转换策略
- **D-06: 双模式转换。** 检测 `process.argv` 中是否包含 `--json`：
  - **JSON 模式:** 收集完整 stdout → `JSON.parse()` → 遍历查找费用字段 → 追加 `costCNY` 字段 → `JSON.stringify()` 输出。不改动原始字段。
  - **文本模式:** `stream.Transform` 逐块正则替换 `$(\d+\.?\d*)` → `¥(CNY值)`。保持流式输出，不缓存完整响应。
- **D-07:** spawn 时注入 `FORCE_COLOR=1` 环境变量，保留上游 ANSI 彩色输出。不依赖 `node-pty`（复杂度不匹配收益）。

### 汇率策略
- **D-08: 三层回退。** 优先级：
  1. `CCUSAGE_CNY_RATE` 环境变量（若设置且为有效数字，直接使用）
  2. CDN 免费 API 缓存（Node.js 内置 `fetch()` → jsDelivr/@fawazahmed0/currency-api，cache 在 `~/.ccusage-cn/cache/rate.json`，24h TTL）
  3. 硬编码默认值 `7.2`（离线/网络失败时使用）
  
  CDN fetch 异步非阻塞：如果缓存未过期直接用缓存；如果需要刷新则在后台 fetch，不阻塞本次输出。

### CLI 兼容性
- **D-09:** `process.argv.slice(2)` 逐字转发所有 CLI 参数到上游进程。不做任何参数解析、校验或过滤。
- **D-10:** 子进程退出码和 stderr 完全透传。`--help` 输出透传上游帮助信息，仅在末尾追加 ccusage-cn 特有的环境变量说明。

### npm 包结构
- **D-11:** `package.json` 声明 `ccusage@^20.0.0` 为 dependency（非 devDependency、非 peerDependency）。用户 `bunx ccusage-cn` 时自动拉取上游及平台二进制。
- **D-12:** `bin` 字段指向 Node.js 脚本（`./bin/cli.js`），**绝不**指向原生二进制。保证跨平台兼容（Windows `.cmd` shim 安全）。

### Claude's Discretion
- 汇率缓存文件路径默认为 `~/.ccusage-cn/cache/rate.json`，Windows 上使用 `%LOCALAPPDATA%/ccusage-cn/cache/rate.json`
- JSON 模式下 `costCNY` 字段的命名和放置位置由实现决定（建议放在对应 `costUSD` 字段旁边）
- CDN fetch 超时设为 5 秒，避免长时间阻塞
- 汇率精度：人民币显示保留两位小数（`¥12.34`）

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 上游项目
- `https://github.com/ccusage/ccusage` — 上游仓库源码、CLI 架构
- `https://www.npmjs.com/package/ccusage` — npm 包结构、平台特定可选依赖
- 上游 `cli.js` 源码（安装后在 `node_modules/ccusage/src/cli.js`） — `resolveCliRuntime` 导出和 spawn 模式

### 项目规划文档
- `.planning/PROJECT.md` — 项目上下文和核心价值
- `.planning/REQUIREMENTS.md` — v1 需求（16 项），本阶段覆盖 13 项
- `.planning/ROADMAP.md` — 3 阶段路线图
- `.planning/research/ARCHITECTURE.md` — Transform Stream Wrapper 架构模式
- `.planning/research/STACK.md` — 零依赖 Node.js ESM 技术栈推荐
- `.planning/research/PITFALLS.md` — 12 个关键陷阱及缓解策略（必读）

### 参考项目
- `yamamuteki/scx` (GitHub) — pipe-based 货币转换 CLI，四层汇率解析模式参考

## Existing Code Insights

### Reusable Assets
- 上游 `ccusage/src/cli.js` — `resolveCliRuntime()` 二进制解析逻辑，可直接 import 复用
- 上游 `ccusage/src/cli.js` — spawn 模式（signal forwarding, exit code propagation），可参考实现

### Established Patterns
- 上游使用纯 JavaScript ESM + JSDoc 类型注释 — 保持一致性
- 上游通过 npm optionalDependencies 管理平台特定二进制 — 无需额外处理

### Integration Points
- 包装器作为上游的透明代理，唯一的侵入点是 stdout pipe（而非 inherit）
- 不修改上游代码、不 patch node_modules、不 fork 仓库

## Specific Ideas

用户期望的工作流：
```bash
bunx ccusage-cn -b                    # 等效于 bunx ccusage -b，但费用显示 ¥
bunx ccusage-cn blocks --active       # 等效于 bunx ccusage blocks --active
bunx ccusage-cn blocks --recent       # 等效于 bunx ccusage blocks --recent
bunx ccusage-cn daily --since 2026-06-01   # 所有上游参数均支持
CCUSAGE_CNY_RATE=7.25 bunx ccusage-cn -b   # 自定义汇率
```

关键原则：用户输入 = 上游输入，输出仅费用单位不同。

## Deferred Ideas

| 想法 | 目标阶段 | 备注 |
|------|----------|------|
| 实时汇率 API 自动获取 | Phase 3 / v2 (RATE) | MVP 使用 env var + 默认值即可 |
| 双币种展示（USD + CNY 并排） | v2 (ENH-02) | 增加列宽，影响表格布局 |
| `--rate` 和 `--cost-unit` CLI 标志 | v2 (RATE-03, ENH-04) | 需解析 CLI 参数，违背 D-09 |
| Statusline 命令本地化 | v2 (ENH-01) | 需验证上游 statusline 输出格式 |
| MCP 服务器本地化 | v2+ | 依赖上游 MCP 功能稳定 |
| 上游更新自动检测/通知 | Phase 3 (UPD-02) | CI 定时检测，不在包装器内实现 |

---
*Phase: 1-核心包装器 (MVP)*
*Context gathered: 2026-07-08*
