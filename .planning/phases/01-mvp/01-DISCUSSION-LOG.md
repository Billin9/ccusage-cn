# Phase 1: 核心包装器 (MVP) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 1-核心包装器 (MVP)
**Areas discussed:** 实现技术栈, 二进制解析与进程管理, 输出转换策略, 汇率策略, CLI兼容性, npm包结构

---

## 实现技术栈

| Option | Description | Selected |
|--------|-------------|----------|
| Node.js 18+ ESM | 纯 JavaScript，零运行时依赖，无构建步骤 | ✓ |
| TypeScript + 构建 | 需要编译步骤，增加复杂度 | |
| Shell 脚本 | 跨平台兼容性差，难以处理流式输出 | |

**Auto-selected:** Node.js 18+ ESM（研究推荐，上游一致）

## 二进制解析与进程管理

| Option | Description | Selected |
|--------|-------------|----------|
| `child_process.spawn()` + `stdout:pipe` | 流式处理，无 maxBuffer 限制 | ✓ |
| `child_process.exec()` | 有 maxBuffer 限制，不适合大输出 | |
| `child_process.execSync()` | 同步阻塞，完全不适合 CLI 工具 | |

**Auto-selected:** spawn + pipe（研究推荐，避免 maxBuffer 和 shell 注入）

## 输出转换策略

| Option | Description | Selected |
|--------|-------------|----------|
| 双模式（文本 regex + JSON 解析） | 文本用 stream regex 替换，JSON 用解析+追加字段 | ✓ |
| JSON-only（调上游 --json 再自行渲染表格） | 解析可靠但表格渲染复杂，增加大量代码 | |
| 纯文本替换 | 简单但对 ANSI/格式变化脆弱 | |

**Auto-selected:** 双模式（兼顾两种使用场景，JSON 路径提供 schema 安全）

## 汇率策略

| Option | Description | Selected |
|--------|-------------|----------|
| 三层回退（env var > CDN 缓存 > 硬编码） | 灵活且鲁棒，离线可用 | ✓ |
| 仅环境变量 | 简单但不够用户友好 | |
| 实时 API 为主 | 需要 API key，中国大陆可达性未知 | |

**Auto-selected:** 三层回退（研究推荐，PITFALLS.md 验证了多层回退的必要性）

## CLI 兼容性

| Option | Description | Selected |
|--------|-------------|----------|
| `process.argv.slice(2)` 零解析 | 完全透传，永不过滤 | ✓ |
| 解析特定标志 | 可以添加自定义标志，但耦合上游 CLI 接口 | |
| 白名单模式 | 需要维护上游命令列表，脆弱 | |

**Auto-selected:** 零解析透传（核心需求，最小维护代价）

## npm 包结构

| Option | Description | Selected |
|--------|-------------|----------|
| `bin` → Node.js 脚本，`ccusage` 作为 dependency | 跨平台安全，bunx 友好 | ✓ |
| `bin` → 原生二进制 | Windows `.cmd` shim 破坏（PITFALLS.md #4） | |
| Fork 上游自己构建 | 维护成本高，违背核心理念 | |

**Auto-selected:** Node.js bin + ccusage dependency（PITFALLS.md 验证了 Windows 兼容性要求）

## Claude's Discretion

- 汇率缓存路径: `~/.ccusage-cn/cache/rate.json`（macOS/Linux），`%LOCALAPPDATA%/ccusage-cn/cache/rate.json`（Windows）
- JSON 模式 `costCNY` 字段放在对应 `costUSD` 旁边
- CDN fetch 超时 5 秒
- 汇率精度保留两位小数

## Deferred Ideas

- 实时汇率 API 自动获取 → Phase 3 / v2 (RATE)
- 双币种展示 → v2 (ENH-02)
- `--rate` / `--cost-unit` CLI 标志 → v2
- Statusline 本地化 → v2 (ENH-01)
- MCP 服务器本地化 → v2+
- 上游更新自动检测 → Phase 3 (UPD-02)
