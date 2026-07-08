# Phase 3: CI 与更新维护 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 3-CI 与更新维护
**Areas discussed:** CI 工作流结构, 集成测试范围, 上游兼容性检测策略, 跨平台 CI 矩阵, README CI badge

---

## CI 工作流结构

| Option | Description | Selected |
|--------|-------------|----------|
| 单文件工作流 | 一个 `ci.yml` 同时处理 push 测试和定时兼容性检测 | |
| 多文件工作流 | `ci.yml`（push/PR）+ `compat-check.yml`（cron）职责分离 | ✓ |

**Auto-selected:** 多文件工作流 — 职责分离，cron 独立配置，互不影响。
**Notes:** 两个工作流共享 vitest 测试套件，失败处理独立：push 失败阻塞合并，cron 失败仅告警。

---

## 集成测试范围

| Option | Description | Selected |
|--------|-------------|----------|
| 仅单元测试 | 现有 `test/output-transform.test.js`，26 个测试用例 | |
| 单元 + 集成 + 冒烟 | 三层：单元测试 + spawn 真实进程验证 + 端到端冒烟 | ✓ |

**Auto-selected:** 三层测试 — 单元测试保证转换逻辑正确，集成测试验证进程管理，冒烟测试确认基本可用。
**Notes:** 集成测试使用 `CCUSAGE_CNY_RATE=7.0` 固定汇率确保 CI 环境可重复。不依赖网络（避免 flaky tests）。

---

## 上游兼容性检测策略

| Option | Description | Selected |
|--------|-------------|----------|
| 手动触发 | 仅通过 workflow_dispatch 手动运行 | |
| 每周 cron | 每周日 UTC 0:00 定时执行 `npm view` + 安装测试 + 失败告警 | ✓ |

**Auto-selected:** 每周 cron — 兼顾自动化与资源节省。兼容性破坏时自动创建 GitHub Issue（标签 `compat-break`）。
**Notes:** `npm view ccusage version` 获取最新版本，major bump 时临时安装新版本测试，不在 package.json 中持久化。

---

## 跨平台 CI 矩阵

| Option | Description | Selected |
|--------|-------------|----------|
| 单平台 | 仅 ubuntu-latest + Node.js 20 | |
| 三平台三版本 | ubuntu/macos/windows + Node.js 18/20/22（9 组合） | ✓ |

**Auto-selected:** 三平台三版本 — 实现 Phase 2 承诺的跨平台 CI 验证。compat-check.yml 仅用 ubuntu-latest 减少资源。
**Notes:** Windows CI 统一使用 `npx` 或直接 `node bin/cli.js`（bun 在 Windows 可能不可用）。

---

## README CI Badge

| Option | Description | Selected |
|--------|-------------|----------|
| 不添加 badge | 保持 README 简洁 | |
| 添加 CI badge | GitHub Actions 原生 badge 展示 ci.yml 运行状态 | ✓ |

**Auto-selected:** 添加 CI badge — 提升项目可信度，展示维护活跃度。
**Notes:** Badge 格式：`![CI](https://github.com/{owner}/{repo}/actions/workflows/ci.yml/badge.svg)`

---

## Claude's Discretion

- GitHub Actions workflow 文件命名：`.github/workflows/ci.yml` 和 `.github/workflows/compat-check.yml`
- CI 超时：`ci.yml` 15 分钟，`compat-check.yml` 10 分钟
- 集成测试文件位置：`test/integration.test.js`
- Issue 创建使用 `gh issue create` CLI 或 `actions-cool/issues-helper` action
- vitest 配置通过 CI 环境变量覆盖，无需修改 `vitest.config.js`
- Windows CI 不依赖 bun，统一使用 Node.js 原生方式运行

## Deferred Ideas

- npm 自动发布（CD）— 手动发布足够当前规模
- 代码覆盖率报告（Codecov/Coveralls）— 测试框架已就绪，后续接入
- Dependabot/Renovate 自动依赖更新 — 单一依赖 caret 范围已自动兼容
- 性能回归检测 — CLI 性能非当前瓶颈
- E2E 测试：真实 AI 工具日志解析 — CI 环境复杂，留待后续
