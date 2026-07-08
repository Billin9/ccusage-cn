# ccusage-cn

## What This Is

ccusage-cn 是 [ccusage](https://github.com/ccusage/ccusage) 的人民币（CNY）适配版本——一个分析 AI 编程工具 Token 用量的 CLI 工具。它在完全兼容原版 ccusage 所有命令和参数的基础上，将费用展示从美元（USD）转换为人民币（CNY），面向中国开发者提供更直观的成本洞察。

## Core Value

**以最小维护代价，持续继承上游更新，实现 AI 编程 Token 费用的本地货币化展示。**

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 作为用户，我可以使用 `bunx ccusage-cn` 替代 `bunx ccusage`，所有命令和参数完全兼容
- [ ] 作为用户，费用输出自动以人民币（¥/CNY）显示，而非美元
- [ ] 作为用户，上游 ccusage 更新时，ccusage-cn 可以自动或半自动继承更新
- [ ] 作为用户，汇率转换是实时/可配置的，而非硬编码

### Out of Scope

- 修改上游 ccusage 核心逻辑 — 仅做包装/转换层，不 fork 内核
- 多币种支持 — 仅人民币
- 自定义费率计算方式 — 保持与上游一致的定价模型

## Context

### 上游项目

- **仓库**: https://github.com/ccusage/ccusage (MIT License, 17k+ stars)
- **技术栈**: Rust (89.6%) + Nix + Nushell + TypeScript
- **分发方式**: npm 包 `ccusage`，通过 `bunx ccusage` 直接运行
- **功能**: 从 15+ AI 编程助手（Claude Code、Codex、Copilot、Gemini CLI 等）的本地日志中读取 Token 用量，按日/周/月/会话聚合，并基于 LiteLLM 定价数据计算美元费用
- **架构**: Rust 单体 CLI + Nix flake 构建 + pnpm workspace

### 用户常用命令（必须兼容）

```bash
bunx ccusage -b                    →  bunx ccusage-cn -b
bunx ccusage blocks --active       →  bunx ccusage-cn blocks --active
bunx ccusage blocks --recent       →  bunx ccusage-cn blocks --recent
```

### 技术约束

- 上游项目使用 Rust 编写，编译为原生二进制后通过 npm 分发
- 不能简单 fork 修改源码（维护负担重）
- 需要一种策略在「最小改动」和「自动继承更新」之间取得平衡

## Constraints

- **兼容性**: 必须 100% 兼容上游所有 CLI 参数和输出格式（除费用单位外）
- **维护成本**: 代码改动量最小化，优先考虑 wrapper/adapter 模式
- **分发方式**: 同样通过 npm 包分发，`bunx ccusage-cn` 可用
- **汇率**: 需要支持可配置的 USD→CNY 汇率（实时 API 或手动设定）

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 实现策略待定 | 需要在研究阶段评估 wrapper/adapter/fork 等方案 | — Pending |
| npm 包名 `ccusage-cn` | 与上游命名一致，加 `-cn` 后缀表明本地化版本 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-08 after initialization*
