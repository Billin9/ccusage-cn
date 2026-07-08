---
plan: "02-01"
phase: 2
phase_name: "npm 发布与跨平台支持"
status: complete
started: "2026-07-08T11:19:00.000Z"
completed: "2026-07-08T11:43:00.000Z"
tasks_total: 3
tasks_completed: 3
files_modified:
  - package.json
  - README.md
  - pnpm-lock.yaml
  - src/output-transform.js
  - test/output-transform.test.js
key-files:
  created:
    - README.md
  modified:
    - package.json
    - src/output-transform.js
    - test/output-transform.test.js
commits:
  - eef896d
  - 87931c6
  - a902206
  - version-bump-commit
---

# Plan 02-01: npm 发布配置 SUMMARY

## Objective

将 Phase 1 核心包装器发布至 npm，配置包元数据和 `prepublishOnly` 质量门，创建中英双语 README。

## Results

### Task 1: package.json 发布配置 ✓
- 移除 `"private": true`
- 设置版本号 `1.0.0`（独立 SemVer）
- 添加 `prepublishOnly` 脚本：`npm test && publint`
- 安装 `publint` 作为 devDependency
- 补充元数据：description, keywords, repository, license, homepage

### Task 2: 中英双语 README ✓
- 项目简介（与上游 ccusage 的关系）
- 安装方式（bunx / npx / npm install -g）
- 使用示例（`-b`、`blocks --active`、`--json`）
- 环境变量说明（`CCUSAGE_CNY_RATE`）
- 与上游差异说明
- 兼容版本声明（`ccusage ^20.0.0`）

### Task 3: npm 发布 ✓
- 自动化验证通过（`npm test` 26→27 tests, `publint` all good）
- npm 发布成功：`ccusage-cn@1.0.0` → `ccusage-cn@1.0.1`
  - v1.0.1 包含表头 `(CNY)` 修复

## 发布后验证

| 检查项 | 结果 |
|--------|------|
| `npm view ccusage-cn version` | 1.0.1 ✓ |
| `npm view ccusage-cn description` | 正确 ✓ |
| `npm view ccusage-cn bin` | `{ 'ccusage-cn': 'bin/cli.js' }` ✓ |
| `bunx ccusage-cn@latest -b` | 正常运行，费用以 ¥ 显示 ✓ |
| 表头 `(CNY)` | 正确显示 ✓ |

## Deviations

- npm 发布时遇到 OTP 二次验证，通过 token 认证解决
- 发布过程中发现并修复了表格表头 `(USD)` 未被替换的问题（额外提交）
- 版本号因修复从 1.0.0 升至 1.0.1

## Self-Check: PASSED

- [x] `npm test` 27/27 通过
- [x] `publint` all good
- [x] `bunx ccusage-cn -b` 端到端可用
- [x] 费用显示为 ¥，表头显示 `(CNY)`
- [x] 包在 npmjs.com 上可搜索
