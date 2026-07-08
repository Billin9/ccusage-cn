# Project Research Summary

**Project:** ccusage-cn
**Domain:** npm CLI wrapper — USD-to-RMB adapter for upstream Rust-based CLI tool
**Researched:** 2026-07-08
**Confidence:** HIGH

## Executive Summary

ccusage-cn 是一个零运行时依赖的 Node.js CLI 包装器，它在不修改上游代码的前提下，将 ccusage（一个基于 Rust 的 AI 费用分析工具）的美元输出实时转换为人民币。核心架构是 Transform Stream Wrapper 模式：生成上游二进制进程，通过 `stream.Transform` 管道捕获 stdout，以流式方式将 `$X.XX` 替换为 `¥Y.YY`，同时保留所有上游行为（参数传递、退出码、信号处理和彩色输出）。整个项目约 150 行有效代码。

基于研究的推荐方案是：纯 JavaScript ESM + Node.js 18+ + 零第三方运行时依赖。上游 `ccusage` 本身已发布为 npm 包且自带 Node.js CLI 入口，包装器直接复用其二进制解析逻辑，仅附加一个输出转换层。汇率获取采用三层回退策略：环境变量 `CCUSAGE_CNY_RATE` > CDN 免费 API 缓存 > 硬编码默认值 7.2。JSON 输出处理建议追加 `costCNY` 字段（而非覆盖 `costUSD`），以保持与上游 schema 的向后兼容。

## Key Findings

### Recommended Stack

零运行时依赖。Node.js 内置 API 覆盖所有需求。

**Core technologies:**
- Node.js >= 18 LTS — 内置 `fetch()`、`node:child_process`、完整 ESM 支持
- npm package format — 标准 npm 包，通过 `bunx`/`npx` 消费
- JavaScript ESM (ES2022) — 无构建步骤，上游也使用纯 JS + JSDoc
- pnpm >= 9 — 开发环境，匹配上游 monorepo 设置

### Expected Features

**Must have (table stakes — P1):**
- CLI 参数透传 — 所有上游命令和标志逐字转发
- 基础 RMB 费用展示 — USD 成本按可配置汇率转换为 CNY
- JSON 输出本地化 — 在 `--json` 输出中追加 `costCNY` 字段
- `bunx ccusage-cn` 安装 — npm 包可运行
- 彩色表格兼容 — 使用 `FORCE_COLOR=1` 保留 ANSI 彩色输出
- 离线模式 — `--offline` 使用缓存汇率

**Should have (competitive — P2):**
- 实时汇率 API（Frankfurter API，免费，无需密钥）
- 汇率缓存 + 过期警告（24h TTL）
- `--rate` CLI 标志

**Defer (v2+):**
- 双币种展示模式、`--cost-unit` 格式化、MCP 服务器本地化

### Architecture Approach

Transform Stream Wrapper 模式。

**Major components:**
1. Binary Resolver — 从 node_modules 定位平台特定的 ccusage 原生二进制
2. Argument Forwarder — `process.argv.slice(2)` 逐字传递所有 CLI 参数
3. Binary Spawner — `child_process.spawn()` + 管道 stdout + FORCE_COLOR 注入 + 信号转发 + 退出码传播
4. Output Transform Stream — `stream.Transform` 处理 stdout，regex 替换费用模式，JSON schema 校验
5. Exchange Rate Provider — 三层回退：env var > CDN API 缓存 > 硬编码默认值

### Critical Pitfalls

Top 5 from PITFALLS.md:
1. **上游输出格式变更** — 通过 JSON schema 校验 + 精确版本锁定应对
2. **Stdout 解析被诊断输出污染** — 增量解析 + 完整 JSON 缓冲
3. **信号传递失败** — `foreground-child` + 显式 signal handler
4. **Windows npm shim 不兼容** — `bin` 入口始终指向 Node.js 脚本
5. **汇率 API 不可用** — 多层缓存与回退，从不阻塞

## Implications for Roadmap

### Phase 1: Core Wrapper (MVP)
**Goal:** 构建核心 spawn + transform + propagate 管道，交付所有 P1 功能
**Delivers:** 完整的 `bunx ccusage-cn` CLI，RMB 本地化费用展示

### Phase 2: CI/CD and Publishing
**Goal:** 跨平台 CI + npm 发布自动化 + 版本锁定
**Delivers:** GitHub Actions (macOS/Linux/Windows)、npm publish workflow

### Phase 3: Live Exchange Rate and Caching
**Goal:** 实时汇率 API 集成 + 磁盘缓存
**Delivers:** Frankfurter API、`~/.ccusage-cn/cache/rate.json`、`--rate` CLI 标志

### Phase 4: Enhancements
**Goal:** Statusline 本地化、更新检查器、双币种展示
**Delivers:** 用户体验增强

### Phase 5: Future (v2+)
**Goal:** 持久化配置、MCP 服务器本地化

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | 上游源码已验证，零依赖方案无争议 |
| Features | HIGH | 上游命令参考和输出格式已验证 |
| Architecture | HIGH | Transform Stream Wrapper 是成熟模式 |
| Pitfalls | HIGH | 11/12 个陷阱通过真实 npm 包装器失败案例验证 |

**Overall confidence:** HIGH

## Sources

### Primary (HIGH confidence)
- ccusage npm package v20.0.14 — 包结构、bin 入口、平台可选依赖
- ccusage cli.js 上游源码 — `resolveCliRuntime`、`resolveNativeBinary` 导出
- Node.js `child_process.spawn` + Transform stream 官方文档
- Rust `supports-color` crate: FORCE_COLOR 处理

### Secondary (MEDIUM confidence)
- Frankfurter API / @fawazahmed0/currency-api — 免费汇率 API
- agent-browser#262、piano#412、penumbra#1642 — npm 包装器失败案例
- ccusage.com 官方文档 — CLI 输出示例

---
*Research completed: 2026-07-08*
*Ready for roadmap: yes*
