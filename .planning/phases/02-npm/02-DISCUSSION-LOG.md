# Phase 2: npm 发布与跨平台支持 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 2-npm 发布与跨平台支持
**Areas discussed:** npm 发布流程, 发布前质量门, README 文档, 跨平台验证, 版本号策略, 包元数据

---

## npm 发布流程

| Option | Description | Selected |
|--------|-------------|----------|
| 手动 npm publish | 开发者本地执行 `npm publish --access public`，简单直接 | ✓ |
| CI 自动发布 | GitHub Actions + npm token，自动触发 | |

**User's choice:** [auto] 手动 `npm publish`（推荐默认）
**Notes:** Phase 2 焦点是让包可发布，CI 自动化是 Phase 3 范围。`publishConfig.access` 已设为 `public`。

---

## 发布前质量门

| Option | Description | Selected |
|--------|-------------|----------|
| prepublishOnly 运行 test + publint | `npm test`（vitest）+ `publint` 检查，失败阻断发布 | ✓ |
| 仅手动测试 | 不添加 prepublishOnly，依赖开发者自觉 | |
| 完整 CI 门禁 | lint + test + build + integration test | |

**User's choice:** [auto] prepublishOnly 运行 `npm test && publint`（推荐默认）
**Notes:** 上游也使用 publint，保持一致。vitest 已有 26 个测试用例覆盖核心功能。

---

## README 文档

| Option | Description | Selected |
|--------|-------------|----------|
| 中英双语，中文优先 | README 以中文为主，附英文翻译 | ✓ |
| 纯中文 | 仅中文，面向中国开发者 | |
| 纯英文 | 仅英文，与国际社区一致 | |

**User's choice:** [auto] 中英双语（推荐默认）
**Notes:** 必须包含：项目简介、安装方式、使用示例、环境变量、与上游差异、兼容上游版本。

---

## 跨平台验证

| Option | Description | Selected |
|--------|-------------|----------|
| macOS 完整验证 + Linux/Windows 声明兼容 | 在当前平台运行测试，README 中声明三平台兼容 | ✓ |
| 三平台手动验证 | 三台机器分别手动测试 | |
| CI matrix 验证 | GitHub Actions 三平台并行测试 | |

**User's choice:** [auto] macOS 完整验证 + 声明兼容（推荐默认）
**Notes:** 包装器仅使用 Node.js 内置模块，无平台特定代码。上游 6 个 optionalDependencies 覆盖三平台。完整 CI matrix 属于 Phase 3。

---

## 版本号策略

| Option | Description | Selected |
|--------|-------------|----------|
| 独立 SemVer 1.0.0 | 与上游版本号解耦，独立语义化版本 | ✓ |
| 跟随上游 20.0.14 | 版本号与上游对齐，方便对应 | |
| 混合策略 | 主版本跟上游，次版本独立 | |

**User's choice:** [auto] 独立 SemVer `1.0.0`（推荐默认）
**Notes:** 上游版本号（20.0.14）与包装器版本无直接关系。`ccusage@^20.0.0` 的依赖范围不变。README 中标注兼容的上游版本号。

---

## 包元数据

| Option | Description | Selected |
|--------|-------------|----------|
| 最小必要集 | description, keywords, repository, license, homepage | ✓ |
| 完整配置 | 加上 author, funding, bugs 等所有可选字段 | |
| 保持现状 | 不修改现有 package.json 元数据 | |

**User's choice:** [auto] 最小必要集（推荐默认）
**Notes:** npm 搜索和包页面需要这些字段。license 与上游保持一致（MIT）。repository 指向项目仓库。

---

## Claude's Discretion

- `.npmignore` 是否创建由实现决定（`files` 字段已足够精确）
- README 示例命令的具体数量和展示方式
- `publint` 版本范围 `^0.3.0`

## Deferred Ideas

- CI 自动发布 → Phase 3
- 三平台 CI 验证矩阵 → Phase 3
- 上游兼容性自动检测 → Phase 3
- npm version bump 自动化 → Phase 3
- README 徽章（下载量、CI 状态）→ Phase 3
- 实时汇率 API → v2
- 双币种展示 → v2
