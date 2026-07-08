# Phase 3: CI 与更新维护 - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

## Phase Boundary

建立 GitHub Actions CI 流水线，在每次代码推送时自动运行集成测试，每周定时检测上游 ccusage 兼容性，确保 ccusage-cn 长期可维护且自动继承上游更新。

**本阶段范围:** CI 工作流搭建（push 触发 + 每周 cron）、集成测试编写、上游兼容性自动检测与告警（UPD-02）
**不包括:** npm 自动发布（CD）、实时汇率 API（v2 RATE）、双币种展示（v2 ENH-02）

## Implementation Decisions

### CI 工作流结构
- **D-01:** 采用多文件工作流结构，职责分离：
  - `ci.yml` — push/PR 触发，运行测试 + 构建验证
  - `compat-check.yml` — 每周 cron 触发（周日 UTC 0:00），检测上游兼容性
- **D-02:** 两个工作流共享测试套件，但触发条件和失败处理独立。兼容性检测失败不阻塞正常开发流程（仅告警）。

### 集成测试范围
- **D-03:** 测试分为三层：
  1. **单元测试**（现有 `test/output-transform.test.js`，26 个用例）— 验证输出转换逻辑正确性，mock 汇率和上游输出
  2. **集成测试**（新增）— 真实 spawn `ccusage-cn`（即 `node bin/cli.js`），验证端到端流程：二进制解析 → 上游执行 → 输出转换。使用环境变量 `CCUSAGE_CNY_RATE=7.0` 固定汇率确保可重复
  3. **冒烟测试**（新增）— CI 中运行 `bunx ccusage-cn -b`（或等价 `node bin/cli.js -b`），验证基本可用性
- **D-04:** 集成测试不依赖网络（避免 CI 环境网络不稳定导致 flaky tests）。使用 `CCUSAGE_CNY_RATE` 环境变量固定汇率，跳过 CDN 汇率 fetch。

### 上游兼容性检测策略
- **D-05:** 每周定时执行（cron: `0 0 * * 0`，周日 UTC），流程：
  1. `npm view ccusage version` 获取上游最新版本号
  2. 与 package.json 中的 `ccusage@^20.0.0` caret 范围比对
  3. 若最新版本仍在 `^20.0.0` 范围内 → 运行集成测试确认兼容
  4. 若最新版本为 major bump（如 `21.0.0`）→ 临时安装新版本运行测试，失败则创建 GitHub Issue 告警
- **D-06:** 兼容性破坏的定义：单元测试或集成测试中任一用例失败 = 兼容性破坏。告警方式：GitHub Actions 原生通知 + 自动创建 GitHub Issue（标签 `compat-break`）。

### 跨平台 CI 矩阵
- **D-07:** CI 矩阵覆盖三平台三 Node.js 版本：
  - **操作系统:** `ubuntu-latest`、`macos-latest`、`windows-latest`
  - **Node.js 版本:** `18`（LTS）、`20`（LTS）、`22`（当前）
  - 共 9 个组合，但兼容性检测（compat-check.yml）仅需 `ubuntu-latest` + Node.js 20（减少资源消耗）
- **D-08:** Windows CI 需注意：`bun` 在 Windows 上通过 `bunx` 可能不可用，CI 中统一使用 `npx` 或直接 `node bin/cli.js`。

### README 与项目可见性
- **D-09:** README 添加 CI 状态徽章（GitHub Actions 原生 badge），展示 `ci.yml` 最新运行状态。提升项目可信度和维护活跃度感知。
- **D-10:** 更新 README 中"平台验证状态"部分，将三平台从"声明兼容"更新为"CI 验证通过"（含 badge）。

### Claude's Discretion
- GitHub Actions workflow 文件命名遵循社区惯例（`.github/workflows/ci.yml`）
- `compat-check.yml` 中 npm install 使用 `--no-save` 避免意外修改 lockfile
- CI 超时设置：`ci.yml` 15 分钟，`compat-check.yml` 10 分钟（npm install 耗时 + 测试）
- 集成测试文件放在 `test/integration.test.js`，与现有单元测试共处 `test/` 目录
- Issue 创建使用 `actions-cool/issues-helper` action 或 `gh issue create` CLI
- vitest 配置保持现有 `vitest.config.js`，如需 CI 特定配置通过环境变量覆盖
- 上游版本解析：`npm view ccusage version --json` 获取精确版本号，使用 semver 库（Node.js 内置）判断兼容范围

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目内部文档
- `.planning/PROJECT.md` — 项目核心价值和关键决策
- `.planning/REQUIREMENTS.md` — v1 需求定义，Phase 3 覆盖 UPD-02
- `.planning/ROADMAP.md` — 3 阶段路线图，Phase 3 成功标准
- `.planning/phases/01-mvp/01-CONTEXT.md` — Phase 1 技术决策（D-01~D-12），本阶段 CI 需遵循
- `.planning/phases/02-npm/02-CONTEXT.md` — Phase 2 上下文（D-07 三平台 CI 矩阵属于 Phase 3）

### 现有源码（必读）
- `package.json` — 现有 scripts（test、prepublishOnly）、依赖声明、engines 字段
- `test/output-transform.test.js` — 现有 26 个单元测试，需在 CI 中运行
- `vitest.config.js` — 测试框架配置
- `bin/cli.js` — CLI 入口，集成测试的 spawn 目标
- `src/spawner.js` — 进程管理（CI 集成测试可参考其 spawn 模式）
- `src/output-transform.js` — 输出转换（集成测试验证目标）
- `src/exchange-rate.js` — 汇率获取（CI 需 mock/skip CDN fetch）

### GitHub Actions 参考
- `https://docs.github.com/en/actions` — GitHub Actions 官方文档
- `https://github.com/actions/setup-node` — setup-node action（Node.js 版本管理）
- `https://github.com/actions-cool/issues-helper` — Issue 自动创建 action（可选）
- `https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows` — 工作流失败通知配置

### 上游项目
- `https://github.com/ccusage/ccusage` — 上游仓库，CI 配置参考（如果上游有 `.github/workflows/`）
- `https://www.npmjs.com/package/ccusage` — npm 包页面，用于兼容性检测中获取版本信息

## Existing Code Insights

### Reusable Assets
- `test/output-transform.test.js` — 26 个单元测试直接在 CI 中运行，无需修改
- `vitest.config.js` — 现有 vitest 配置，CI 中通过 `CI=true` 环境变量即可
- `package.json` scripts — `npm test` 已指向 `vitest run`，CI 直接复用
- `src/exchange-rate.js` — 汇率模块支持 `CCUSAGE_CNY_RATE` 环境变量，CI 可固定汇率

### Established Patterns
- 项目使用 vitest 作为测试框架（ESM-native，适合 CI 环境）
- 测试文件使用 `.test.js` 命名约定
- 现有测试采用 mock + snapshot 模式（`test/fixtures/` 目录存放上游原始输出样本）
- `prepublishOnly` 质量门机制 — CI 应复用相同的 `npm test` 命令

### Integration Points
- `.github/workflows/` 目录当前不存在，需从零创建
- CI badge URL 格式：`https://github.com/{owner}/{repo}/actions/workflows/ci.yml/badge.svg`
- README.md 需更新：添加 badge、更新平台验证状态
- 无需修改任何 `src/` 或 `bin/` 源码文件 — CI 是纯基础设施添加

## Specific Ideas

CI 流水线预期行为：

```
Push to main/PR → ci.yml 触发:
  1. Checkout + Setup Node.js (matrix: 18, 20, 22)
  2. npm ci
  3. npm test (vitest run)
  4. (可选) 冒烟测试: node bin/cli.js -b

每周日 UTC 0:00 → compat-check.yml 触发:
  1. Checkout + Setup Node.js (20 LTS)
  2. npm ci
  3. npm view ccusage version → 获取最新版本
  4. 版本比对: 若在 ^20.0.0 范围内 → npm test
     若 major bump → npm install ccusage@latest --no-save → npm test
  5. 失败 → 创建 GitHub Issue 告警
```

README badge 示例：
```markdown
[![CI](https://github.com/{owner}/ccusage-cn/actions/workflows/ci.yml/badge.svg)](https://github.com/{owner}/ccusage-cn/actions/workflows/ci.yml)
```

## Deferred Ideas

| 想法 | 目标阶段 | 备注 |
|------|----------|------|
| npm 自动发布（CD: GitHub Actions + npm token） | 后续 | 手动发布足够当前规模 |
| CI 自动版本号 bump + changelog 生成 | 后续 | 需要更多提交规范 |
| 代码覆盖率报告（Codecov/Coveralls 集成） | 后续 | 测试框架已就绪，仅需接入服务 |
| Dependabot/Renovate 自动依赖更新 | 后续 | 单一依赖 `ccusage` caret 范围已自动兼容 |
| 性能回归检测（benchmark CI） | 后续 | 当前 CLI 性能不是瓶颈 |
| E2E 测试：真实 AI 工具日志解析验证 | 后续 | 需要安装多个 AI 编程工具，CI 环境复杂 |

---
*Phase: 3-CI 与更新维护*
*Context gathered: 2026-07-08*
