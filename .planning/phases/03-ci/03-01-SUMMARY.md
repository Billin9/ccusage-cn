---
phase: 03-ci
plan: 01
subsystem: ci
tags: [github-actions, ci, vitest, integration-testing, compatibility-check]
requires:
  - phase: 02-npm
    provides: npm package with bin entry, platform optionalDependencies
provides:
  - GitHub Actions dual-workflow CI (push/PR trigger + weekly cron)
  - 3 OS x 3 Node version matrix test pipeline
  - Upstream ccusage compatibility check with automatic Issue creation
  - End-to-end integration test suite
affects: [future phases requiring CI validation, automated releases]

tech-stack:
  added: [GitHub Actions, vitest (used for integration tests)]
  patterns:
    - Dual-workflow CI structure (responsibility separation)
    - Matrix strategy for cross-platform testing
    - npm view + cut for upstream version checking

key-files:
  created:
    - .github/workflows/ci.yml
    - .github/workflows/compat-check.yml
    - test/integration.test.js
  modified:
    - README.md

key-decisions:
  - "Dual workflow structure: ci.yml (push/PR) + compat-check.yml (weekly cron) for clear responsibility separation"
  - "actions/checkout@v6 + actions/setup-node@v6 (v4 deprecated since June 2026)"
  - "cut -d. -f1 for major version parsing instead of node:semver (not a Node.js built-in)"
  - "--no-save only on npm install, never on npm ci (npm ci rejects --no-save)"
  - "CCUSAGE_CNY_RATE env var in all CI steps to skip network dependency"
  - "vitest testTimeout increased to 20000ms for integration tests (upstream binary resolution can take >5000ms)"

patterns-established:
  - "CI workflow pattern: checkout@v6 -> setup-node@v6 (cache:npm) -> npm ci -> npm test -> smoke test"
  - "Upstream compat check pattern: npm view version -> cut major -> condition test -> gh issue create"
  - "Integration test pattern: execSync with CCUSAGE_CNY_RATE fixed rate, ESM imports, vitest"

requirements-completed: [UPD-02]

duration: 5min
completed: 2026-07-08
---

# Phase 03 CI: Plan 01 CI 工作流与集成测试 Summary

**GitHub Actions 双工作流 CI 流水线：全矩阵测试 + 上游兼容性定时检测 + 自动告警**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-08T14:24:13Z
- **Completed:** 2026-07-08T14:29:17Z
- **Tasks:** 3
- **Files created:** 3
- **Files modified:** 1

## Accomplishments

- GitHub Actions 双工作流 CI 流水线搭建完成：`ci.yml`（push/PR 触发全矩阵测试）+ `compat-check.yml`（每周 cron 上游兼容性检测）
- 端到端集成测试 4 个用例全部运行通过（--help、-b 不崩溃、退出码传播、环境变量生效）
- README 添加 CI badge + 平台验证状态从"声明兼容"更新为"CI 验证通过"

## Task Commits

Each task was committed atomically:

1. **Task 1: 创建 CI 工作流（ci.yml + compat-check.yml）** - `b485749` (feat)
2. **Task 2: 创建集成测试（test/integration.test.js）** - `04bd004` (test)
3. **Task 3: 更新 README 添加 CI badge 和平台验证状态** - `f7d081a` (docs)

**Plan metadata:** (will be final commit)

## Files Created/Modified

- `.github/workflows/ci.yml` — 日常 CI：push/PR 触发，3 OS x 3 Node 矩阵测试 + 冒烟测试
- `.github/workflows/compat-check.yml` — 每周兼容性检测：npm view 版本比对 + 自动 Issue 创建
- `test/integration.test.js` — 端到端集成测试：验证 CLI 入口、信号转发、退出码传播，4 个用例全部通过
- `README.md` — 添加 CI badge（badge.svg 指向 ci.yml 工作流），平台验证状态更新

## Decisions Made

- **双工作流职责分离**: ci.yml 失败应阻止 PR merge，compat-check.yml 失败仅告警，分开工作流让 GitHub status check 自然区分
- **v6 actions 版本**: actions/checkout@v6 + actions/setup-node@v6（v4 已于 2026-06 弃用）
- **版本比对方案**: 使用 `cut -d. -f1` 替代 `node:semver`（Node.js 无此内置模块）
- **npm install --no-save**: 仅用于 major bump 测试的临时安装，不污染 lockfile；npm ci 不接受此参数
- **固定汇率**: CI 所有步骤设置 CCUSAGE_CNY_RATE=7.0/7.2 跳过网络请求，避免 flaky tests
- **vitest 超时调整**: 集成测试套件设 20000ms timeout（上游二进制首次解析可超 5000ms 默认值）

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest 默认 testTimeout 过短导致集成测试超时**
- **Found during:** Task 2（集成测试验证）
- **Issue:** vitest 默认测试超时为 5000ms，而 execSync timeout 设为 10000ms，导致涉及上游二进制 spawn 的 -b 测试用例在 vitest 超时而非 execSync 超时
- **Fix:** 为两个 -b 测试用例添加 `{ timeout: 20000 }` 选项，确保 vitest 等待时长超过 execSync timeout
- **Files modified:** test/integration.test.js
- **Verification:** 重新运行 `npx vitest run test/integration.test.js`，全部 4 个用例通过（20.5s 总时长）
- **Committed in:** 04bd004 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** 必要的环境适配——vitest 默认超时值不足以容纳上游二进制首次解析耗时。

## Issues Encountered

- 无重大问题。集成测试的首轮运行暴露了 vitest 默认超时设置问题，已通过 per-test timeout 解决。

## User Setup Required

None - 无需外部服务配置。GitHub Actions 在推送代码到远程仓库后自动生效。`GITHUB_TOKEN` 由 GitHub 自动注入。

## Next Phase Readiness

- CI 流水线就绪，后续代码提交将自动触发全矩阵测试
- 上游兼容性检测每周自动运行（需在 GitHub 仓库启用 GitHub Actions）
- 集成测试覆盖了核心 CLI 功能，可作为后续自动发布的预检门
- 建议 Phase 3 后续计划考虑：npm 自动发布工作流（CD）、代码覆盖率报告集成

## Self-Check: PASSED

- [x] `.github/workflows/ci.yml` exists
- [x] `.github/workflows/compat-check.yml` exists
- [x] `test/integration.test.js` exists
- [x] Commit b485749 (Task 1) exists
- [x] Commit 04bd004 (Task 2) exists
- [x] Commit f7d081a (Task 3) exists
- [x] `03-01-SUMMARY.md` created
- [x] All 3 tasks executed and committed
- [x] README contains CI badge (badge.svg) and "CI 验证通过"
- [x] vitest discovers and runs all 4 integration tests

---

*Phase: 03-ci*
*Completed: 2026-07-08*
