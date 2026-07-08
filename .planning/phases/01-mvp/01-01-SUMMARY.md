---
phase: 01-mvp
plan: 01
subsystem: 核心模块
tags: [scaffold, exchange-rate, output-transform, tdd]
dependency:
  requires: []
  provides: [src/exchange-rate.js, src/output-transform.js, src/utils.js]
  affects: [01-02-PLAN.md]
tech-stack:
  added:
    - Node.js 18+ ESM with module type
    - ccusage@^20.0.0 (runtime dependency)
    - vitest@^3.0.0 (devDependency)
  patterns:
    - ESM import/export
    - stream.Transform with remainder buffer
    - async/await with error-first fallback
key-files:
  created:
    - package.json: project metadata, dependencies, bin entry
    - src/exchange-rate.js: three-tier exchange rate retrieval
    - src/utils.js: cross-platform cache directory and number formatting
    - src/output-transform.js: dual-mode output transformation
    - vitest.config.js: test runner config
    - test/output-transform.test.js: 17 test cases covering text and JSON modes
  modified: []
decisions:
  - "Chunk boundary handling: cache any $ at chunk end (even bare $), but exclude complete numbers like $12.34"
  - "JSON key naming: costUSD → costCNY (strip USD suffix), totalCost → totalCostCNY (append CNY)"
  - "Exchange rate cache: atomic write via temp file + rename to avoid partial file corruption"
metrics:
  duration: 241 seconds
  completed: 2026-07-08
---

# Phase 1 Plan 1: 项目脚手架与核心模块 — Summary

**One-liner:** 为 ccusage-cn 建立 Node.js ESM 项目骨架，实现三层汇率回退模块和双模式输出转换 Transform stream，零第三方运行时依赖。

## 完成的任务

| 任务 | 名称 | 提交 | 关键文件 |
|------|------|------|----------|
| 1 | 项目初始化与依赖安装 | 62bebf6 | package.json, .gitignore, pnpm-lock.yaml |
| 2 | 汇率获取模块与工具函数 | 4b2afe8 | src/exchange-rate.js, src/utils.js |
| 3 (RED) | 输出转换模块测试（TDD RED） | da0b6db | test/output-transform.test.js, vitest.config.js |
| 3 (GREEN) | 输出转换模块实现（TDD GREEN） | 5cec1f0 | src/output-transform.js |

## 架构决策

### 1. src/utils.js — 跨平台工具函数
- `getCacheDir()`: 根据平台判断缓存路径（Windows: `%LOCALAPPDATA%/ccusage-cn/cache`, 其他: `~/.ccusage-cn/cache`）
- `formatCNY(amount)`: 保留两位小数精度，`parseFloat(amount.toFixed(2))`

### 2. src/exchange-rate.js — 三层汇率回退
| 层级 | 来源 | 优先级 | 说明 |
|------|------|--------|------|
| 1 | CCUSAGE_CNY_RATE 环境变量 | 最高 | 正则 `/^\d+(\.\d+)?$/` 验证有效性 |
| 2 | CDN 磁盘缓存 | 中 | 24h TTL，过期时后台静默刷新不阻塞 |
| 3 | 硬编码默认值 7.2 | 最低 | 网络不可用时的安全回退 |

### 3. src/output-transform.js — 双模式输出转换
- **文本模式**: `stream.Transform` 逐块正则替换，带 chunk 边界保护（remainder 缓冲区）
- **JSON 模式**: collect → JSON.parse → 递归添加 CNY 字段 → JSON.stringify（保持缩进）
- 费用字段识别: `/^(cost|totalCost|total_cost|charge|price|fee|spend)/i`
- 字段命名: `costUSD → costCNY`（去 USD 后缀），`totalCost → totalCostCNY`

## TDD Gate Compliance

| 门控 | 提交 | 状态 |
|------|------|------|
| RED (test commit) | da0b6db | ✓ |
| GREEN (feat commit) | 5cec1f0 | ✓ |
| REFACTOR (refactor commit) | 不适用 | N/A — 代码无需重构 |

## 验证结果

- [x] package.json 配置正确（type:module, bin, dependencies, devDependencies）
- [x] 目录结构完整（src/, bin/, test/fixtures/）
- [x] src/exchange-rate.js 实现三层汇率回退
- [x] src/output-transform.js 实现双模式输出转换
- [x] 模块可独立导入测试
- [x] 17 个测试全部通过

## 关键指标

- **文件数**: 7 个源文件创建
- **代码行**: ~350 行 JavaScript（不含测试）
- **测试覆盖率**: 17 个测试用例，文本模式 9 个 + JSON 模式 8 个
- **运行时依赖**: 仅 ccusage（零第三方运行时依赖）

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] chunk 边界正则过于贪婪缓存完整 $ 数字**
- **发现于**: 任务 3 (GREEN)
- **问题**: 正则 `\$\d*\.?\d*$` 将完整的 `$12.34` 也匹配为 remainder（因为匹配到字符串末尾），导致完整数字被缓存到下一 chunk 而非立即替换。同时，单独的 `$`（长度 1）不被缓存，导致 "$ $" 分拆时失败。
- **修复**: 添加 `!/\.\d+$/.test(partial[0])` 条件排除完整的数字格式（含小数部分的 `$X.XX`）；移除 `length > 1` 限制以缓存单独的 `$` 符号
- **文件修改**: src/output-transform.js
- **提交**: 5cec1f0

**2. [Rule 2 - 功能缺失] JSON 模式中 costUSD 的 CNY 字段名称**
- **发现于**: 任务 3 (GREEN)
- **问题**: `${key}CNY` 对 `costUSD` 生成 `costUSDCNY`，但预期是 `costCNY`（测试 5 验证）
- **修复**: 添加 `cnyFieldName()` 函数，对以 `USD` 结尾的字段去掉后缀再追加 `CNY`（如 `costUSD → costCNY`）；其他字段直接追加（如 `totalCost → totalCostCNY`）
- **文件修改**: src/output-transform.js
- **提交**: 5cec1f0

### 缺失项（下一计划需创建）
- bin/cli.js（在 Plan 02 中创建）
- src/binary-resolver.js（在 Plan 02 中创建）
- src/spawner.js（在 Plan 02 中创建）

---

## Self-Check: PASSED

- [x] package.json 存在且包含所需字段
- [x] src/exchange-rate.js 存在且导出 getExchangeRate
- [x] src/utils.js 存在且导出 getCacheDir, formatCNY
- [x] src/output-transform.js 存在且导出 createTextTransform, createJsonTransform
- [x] test/output-transform.test.js 17 个测试全部通过
- [x] ccusage 上游可导入 resolveCliRuntime
- [x] 提交 62bebf6, 4b2afe8, da0b6db, 5cec1f0 均存在
