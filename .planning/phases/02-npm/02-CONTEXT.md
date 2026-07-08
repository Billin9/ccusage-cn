# Phase 2: npm 发布与跨平台支持 - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

## Phase Boundary

将 Phase 1 已完成的核心包装器（`ccusage-cn`）发布至 npm 公共注册表，确保 macOS/Linux/Windows 三平台用户可通过 `bunx ccusage-cn` 或 `npx ccusage-cn` 开箱使用。

**本阶段范围:** npm 包发布就绪（DIST-01）、三平台兼容性声明与验证（DIST-03）
**不包括:** CI 自动化流水线（Phase 3）、自动化发布（Phase 3）、上游兼容性定时检测（Phase 3）

## Implementation Decisions

### npm 发布流程
- **D-01:** 采用手动 `npm publish` 发布。不在此阶段引入 CI 自动发布——CI 自动化属于 Phase 3 范围。发布命令：`npm publish --access public`。
- **D-02:** 移除 `package.json` 中的 `"private": true`。当前值为 `true` 会阻止发布。

### 发布前质量门
- **D-03:** 添加 `prepublishOnly` 脚本，在 `npm publish` 前自动运行测试套件（`vitest run`）。测试失败时阻断发布。上游 ccusage 使用 `publint` 做打包验证，我们也加入 `publint` 检查。
- **D-04:** `package.json` scripts 更新为：
  ```json
  {
    "test": "vitest run",
    "prepublishOnly": "npm test && publint"
  }
  ```
  需要将 `publint` 添加为 devDependency（与上游保持一致）。

### README.md 文档
- **D-05:** README 采用中英双语，中文为主、英文为辅。面向中国开发者，中文提供最佳可读性；保留英文方便国际用户和搜索引擎索引。
- **D-06:** README 最少包含以下章节：
  1. 项目简介（ccusage-cn 是什么，与上游 ccusage 的关系）
  2. 安装方式（`bunx ccusage-cn`、`npx ccusage-cn`、`npm install -g ccusage-cn`）
  3. 使用示例（常用命令对照：`-b`、`blocks --active`、`--json`）
  4. 环境变量（`CCUSAGE_CNY_RATE` 自定义汇率）
  5. 与上游差异（费用显示单位从 USD 变为 CNY，其他完全一致）
  6. 兼容的上游版本（`ccusage ^20.0.0`）

### 跨平台验证策略
- **D-07:** Phase 2 在当前平台（macOS ARM64）完成完整功能验证（`npm test` + 手动 `bunx ccusage-cn -b` 端到端测试）。Linux 和 Windows 通过以下机制保证兼容：
  - 上游 ccusage 已通过 6 个 `optionalDependencies` 覆盖三平台（darwin-arm64/x64, linux-arm64/x64, win32-x64/arm64）
  - 包装器仅使用 Node.js 内置模块（`node:child_process`、`node:stream`、`node:process`），无平台特定代码
  - `binary-resolver.js` 已实现跨平台路径解析（含 Windows `exe` 后缀处理）
  - `utils.js` 已处理 Windows 缓存目录差异（`%LOCALAPPDATA%` vs `~/.ccusage-cn`）
- **D-08:** 完整的三平台 CI 验证矩阵属于 Phase 3 范围。Phase 2 在 README 中声明三平台兼容，注明已验证和待验证平台。

### 版本号策略
- **D-09:** ccusage-cn 初始版本号 `1.0.0`，采用独立语义化版本（SemVer）。不与上游 ccusage 版本号（当前 20.0.14）绑定或对齐。
- **D-10:** 上游依赖范围保持 `ccusage@^20.0.0`（caret 范围），自动兼容 patch/minor 更新。README 中明确标注当前兼容的上游版本，供用户参考。

### 包元数据完善
- **D-11:** `package.json` 补充以下元数据字段（npm 搜索和包页面需要）：
  - `description`: "ccusage 的人民币（CNY）适配版本 — 分析 AI 编程工具 Token 用量，费用以人民币展示"
  - `keywords`: ["ccusage", "token", "usage", "ai", "cli", "cn", "cny", "chinese", "renminbi"]
  - `repository`: 指向项目仓库 URL
  - `license`: "MIT"（与上游一致）
  - `homepage`: 指向项目 README 或仓库

### Claude's Discretion
- 是否添加 `.npmignore` 文件由实现决定。当前 `package.json` 的 `files` 字段已限制发布内容为 `bin/`、`src/`、`package.json`、`README.md`，足够精确，不一定需要 `.npmignore`
- README 中示例命令的具体数量和展示方式由实现决定
- `publint` 的具体版本范围建议 `^0.3.0`（与上游 devDependencies 保持一致）
- 如果项目已有 GitHub 仓库 URL，填入 `repository` 和 `homepage` 字段；否则留空待创建

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目内部文档
- `.planning/PROJECT.md` — 项目核心价值和关键决策
- `.planning/REQUIREMENTS.md` — v1 需求定义，Phase 2 覆盖 DIST-01、DIST-03
- `.planning/ROADMAP.md` — 3 阶段路线图，Phase 2 成功标准
- `.planning/phases/01-mvp/01-CONTEXT.md` — Phase 1 上下文（技术决策 D-01~D-12 均适用）

### 现有源码（必读）
- `package.json` — 当前包配置，需修改 `private` 并补充元数据
- `bin/cli.js` — CLI 入口，发布后作为 `ccusage-cn` 命令的执行入口
- `src/binary-resolver.js` — 跨平台二进制解析（已处理 Windows/Linux/macOS 差异）
- `src/spawner.js` — 进程管理（信号转发、退出码传播）
- `src/output-transform.js` — 输出转换（文本/JSON 双模式）
- `src/exchange-rate.js` — 汇率获取（三层回退策略）
- `src/utils.js` — 跨平台工具（缓存目录、金额格式化）

### 上游参考
- `node_modules/ccusage/package.json` — 上游包结构（bin、files、optionalDependencies 模式）
- `https://www.npmjs.com/package/ccusage` — 上游 npm 包页面
- `https://github.com/ccusage/ccusage` — 上游仓库

## Existing Code Insights

### Reusable Assets
- Phase 1 全部 5 个源模块（`bin/cli.js` + `src/` 下 5 个文件）无需修改——Phase 2 仅需完善包发布元数据
- 现有测试套件（`test/output-transform.test.js`，26 个测试用例）已覆盖核心转换逻辑
- `vitest.config.js` 可直接复用，无需修改

### Established Patterns
- 上游发布模式：`bin` → JS wrapper → spawn native binary + `optionalDependencies` 按平台安装二进制
- 包装器零依赖设计（仅 `ccusage` 一个 dependency）保持简单
- 上游使用 `publint` 验证包质量——保持一致

### Integration Points
- `package.json` 是唯一需要实质性修改的文件（移除 `private`、添加 `prepublishOnly`、补充元数据）
- `bin/cli.js` 已通过 `#!/usr/bin/env node` shebang 正确配置可执行入口
- `files` 字段已正确配置，发布时自动排除 `test/`、`node_modules/`、`.planning/` 等目录

## Specific Ideas

npm 发布后的用户工作流：
```bash
# 首次使用（自动安装并运行）
bunx ccusage-cn -b

# 全局安装
npm install -g ccusage-cn

# 自定义汇率
CCUSAGE_CNY_RATE=7.25 ccusage-cn blocks --active

# JSON 模式
ccusage-cn --json daily --since 2026-06-01
```

## Deferred Ideas

| 想法 | 目标阶段 | 备注 |
|------|----------|------|
| CI 自动发布（GitHub Actions + npm token） | Phase 3 | 手动发布足够 MVP |
| 三平台 CI 验证矩阵（macOS/Linux/Windows） | Phase 3 (UPD-02) | 当前依赖上游平台包覆盖 |
| 上游兼容性自动检测（每周 cron） | Phase 3 (UPD-02) | CI 定时拉取最新 ccusage 运行测试 |
| npm version bump 自动化 | Phase 3 | 手动 `npm version patch` 足够初期使用 |
| npm 下载量徽章、CI 状态徽章 | Phase 3 | README 装饰性内容，非阻塞 |
| 实时汇率 API 自动获取 | v2 (RATE) | 已在 Phase 1 延期 |
| 双币种展示 | v2 (ENH-02) | 已在 Phase 1 延期 |

---
*Phase: 2-npm 发布与跨平台支持*
*Context gathered: 2026-07-08*
