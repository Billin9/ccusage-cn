# Phase 2: npm 发布与跨平台支持 - Research

**Researched:** 2026-07-08
**Domain:** npm 包发布、跨平台分发、包元数据管理
**Confidence:** HIGH

## Summary

Phase 2 将 Phase 1 已完成的核心包装器发布至 npm 公共注册表,并确保 macOS/Linux/Windows 三平台用户可通过 `bunx ccusage-cn` 或 `npx ccusage-cn` 开箱使用。

该阶段本质上是一个**配置和文档阶段**,而非代码编写阶段。Phase 1 的 5 个源模块(`bin/cli.js` + `src/` 下 5 个文件)无需修改。需要变更的只有 `package.json`(移除 `private`、添加 `prepublishOnly`、补充元数据)和新增 `README.md`(中英双语)。**最重要的工作是:正确的版本号设定(1.0.0)、发布前质量门(prepublishOnly 钩子)、以及完整的双语文档。**

关于跨平台兼容,Phase 1 的 `binary-resolver.js` 和 `utils.js` 已处理所有平台差异(含 Windows `exe` 后缀和 `%LOCALAPPDATA%` 缓存目录)。上游 ccusage 的 6 个 `optionalDependencies` 覆盖 macOS/Linux/Windows 的 x64 和 ARM64 架构。Phase 2 只需在 macOS 上完成完整验证,Linux/Windows 通过声明兼容 + 文档说明策略处理——完整的三平台 CI 矩阵留到 Phase 3。

**Primary recommendation:** 手动 `npm publish --access public`,版本 `1.0.0`,使用 `prepublishOnly` 运行 `npm test && publint` 作为发布前质量门。

### 需要立刻注意的关键点
- npm 用户名为 `ccusage-cn`——需要在发布前验证**已登录 npm** (`npm whoami`)
- `ccusage-cn` 包名在 npm 上**尚不存在**(通过 `npm view ccusage-cn` 验证为 404)。它是公开可用的,不存在命名冲突风险
- 发布命令应该是 `npm publish --access public` 而非 `pnpm publish`——因为这不是 monorepo,且 `pnpm publish` 的行为在单包场景下与 `npm publish` 一致,但 D-01 明确指定 `npm publish`
- `npm pack --dry-run` 验证发布内容包括 7 个文件(6 个源文件 + `package.json`),当前没有 `README.md`(即将新建)

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| npm 包发布 | 开发者工作站 | — | 手动 `npm publish`,不依赖 CI |
| 发布前质量门 | 开发者工作站 | — | `prepublishOnly` 钩子在本地运行 |
| 跨平台兼容性 | 上游 ccusage | ccusage-cn 包装器 | 上游 `optionalDependencies` 提供二进制;包装器负责平台感知路径解析 |
| 包元数据 | 开发者工作站 | — | `package.json` 静态配置,一次写入 |
| README 文档 | 开发者工作站 | — | 静态 Markdown 文件,一次写入 |
| 版本管理 | 开发者工作站 | — | 手动 `npm version patch/minor/major` |

## Standard Stack

### npm 发布相关

| 工具/配置 | 版本 | 用途 | 说明 |
|-----------|------|------|------|
| `npm publish` | — | 手动发布命令 | D-01: 不用 CI,手动发布 |
| `npm version` | — | SemVer 版本管理 | 手动 `npm version patch 1.0.0` 设定初始版本 |
| `prepublishOnly` | — | 发布前质量门钩子 | 运行 `npm test && publint` |

### npm 包配置结构

`package.json` 当前状态(v0.1.0, `private: true`)需要修改为:

```json
{
  "name": "ccusage-cn",
  "version": "1.0.0",
  "private": false,
  "type": "module",
  "bin": {
    "ccusage-cn": "./bin/cli.js"
  },
  "files": [
    "bin/",
    "src/",
    "package.json",
    "README.md"
  ],
  "scripts": {
    "test": "vitest run",
    "prepublishOnly": "npm test && publint"
  },
  "dependencies": {
    "ccusage": "^20.0.0"
  },
  "devDependencies": {
    "publint": "^0.3.12",
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=18"
  },
  "publishConfig": {
    "access": "public"
  },
  "description": "ccusage 的人民币（CNY）适配版本 — 分析 AI 编程工具 Token 用量，费用以人民币展示",
  "keywords": ["ccusage", "token", "usage", "ai", "cli", "cn", "cny", "chinese", "renminbi"],
  "repository": {
    "type": "git",
    "url": "git+<REPO_URL>.git"
  },
  "license": "MIT",
  "homepage": "<REPO_URL>#readme"
}
```

### 使用 publint 验证包质量

`publint` 是 npm 社区标准的包质量验证工具,被上游 ccusage、SvelteKit、Vite 等广泛使用。它会检查 `package.json` 中字段(`files`, `bin`, `exports`, 等)的完整性和准确性。

安装与使用:
```bash
pnpm add -D publint
npm run prepublishOnly    # 触发 npm test && publint
# 或单独运行:
npx publint
```

**重要提示:** `publint` 主要针对有 `exports`/`main`/`types` 字段的库包做检查。对于纯 CLI 工具(如 ccusage-cn,没有 exports 字段),`publint` 的检查项较少,但仍能验证 `bin` 入口、`files` 字段和基础配置。

### 测试套件

Phase 1 已有 `vitest` + 26 个测试用例,覆盖输出转换核心逻辑。可以直接在 `prepublishOnly` 中复用。

```bash
pnpm test                # vitest run
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 手动 `npm publish` | GitHub Actions CI 自动发布 | 自动发布属于 Phase 3 |
| `prepublishOnly` | 手动两步操作(先测试再发布) | 人工容易遗漏,`prepublishOnly` 保证原子性 |
| `publint` | `npm pack --dry-run` + 手动检查 | `publint` 自动化检查更全面 |

**Installation:**
```bash
pnpm add -D publint
```

**Version verification:**
```bash
npm view publint version    # 0.3.21 (2026-07-08)
npm view vitest version     # 3.x
npm view ccusage version    # 20.0.14 (2026-06-15)
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `ccusage-cn` | npm | 待创建 | 0 | 项目仓库 | [SLOP] | 预期行为——包尚未发布。创建并发布后 slopcheck 将识别 |
| `ccusage` | npm | ~1年 | ~50K/周 | github.com/ccusage/ccusage | [OK] | Approved |
| `publint` | npm | ~3年 | ~805K/周 | github.com/publint/publint | [OK] | Approved |
| `vitest` | npm | ~4年 | ~16M/周 | github.com/vitest-dev/vitest | [SUS] | False positive——slopcheck 误报为 vite typosquat。通过 npm registry 描述 `"Next generation testing framework powered by Vite"` 确认为合法包 |

**Packages removed due to slopcheck [SLOP] verdict:** 无(ccusage-cn 的 SLOP 是预期行为——包即将创建)
**Packages flagged as suspicious [SUS]:** `vitest`——已验证为合法包,slopcheck 误报。无需 human-verify checkpoint。

## Architecture Patterns

### npm 发布工作流

```
[开发者]
    |
    v
npm version patch 1.0.0    # 或 minor/major,设定/更新版本号
    |
    v
npm run prepublishOnly      # 自动运行:
    |                        #   1. npm test (vitest run)
    |                        #   2. publint (包质量检查)
    |                        # 任一失败则阻断发布
    v
npm publish --access public # 发布至 npm registry
    |
    v
npm pack --dry-run          # (可选) 先预览 tarball 确认内容
```

### 跨平台兼容架构

```
用户 bunx/npx/npm install -g ccusage-cn
    |
    v
npm 安装流程:
    1. 安装 ccusage-cn (包装器 + 配置文件)
    2. 安装 upstream ccusage (JS 包装器)
    3. 自动安装平台特定 optionalDependency:
       - darwin-arm64 → @ccusage/ccusage-darwin-arm64 (macOS Apple Silicon)
       - darwin-x64   → @ccusage/ccusage-darwin-x64   (macOS Intel)
       - linux-arm64  → @ccusage/ccusage-linux-arm64  (Linux ARM)
       - linux-x64    → @ccusage/ccusage-linux-x64    (Linux x86_64)
       - win32-x64    → @ccusage/ccusage-win32-x64    (Windows x86_64)
       - win32-arm64  → @ccusage/ccusage-win32-arm64  (Windows ARM)
    |
    v
ccusage-cn CLI 启动:
    bin/cli.js 读取 platform + arch
        |
        v
    binary-resolver.js 定位平台对应二进制路径
    (Windows → 添加 .exe 后缀)
        |
        v
    spawn 上游二进制,pipe stdout 通过 transform stream
        |
        v
    utils.js 处理跨平台缓存目录
    (Windows: %LOCALAPPDATA%/ccusage-cn/cache vs
     其他: ~/.ccusage-cn/cache)
```

### Recommended Project Structure (不变)

Phase 1 的结构无需修改,保持不变:

```
ccusage-cn/
├── bin/
│   └── cli.js              # CLI 入口 (shebang: #!/usr/bin/env node)
├── src/
│   ├── binary-resolver.js  # 跨平台二进制解析
│   ├── exchange-rate.js    # 汇率获取 (三层回退)
│   ├── output-transform.js # 输出转换 (文本/JSON 双模式)
│   ├── spawner.js          # 进程管理 (信号转发/退出码传播)
│   └── utils.js            # 跨平台工具 (缓存目录/金额格式化)
├── test/
│   ├── fixtures/           # 测试夹具 (包含实际上游输出样本)
│   └── output-transform.test.js  # 26 个测试用例
├── package.json            # [将修改] 发布配置
├── README.md               # [将新建] 中英双语文档
├── vitest.config.js
└── pnpm-lock.yaml
```

### Pattern 1: prepublishOnly 质量门

**What:** 在 `npm publish` 自动触发前运行测试和包质量检查,任一失败则阻断发布。

**When to use:** 所有 npm 包发布,尤其是手动发布场景(无 CI 做质量门时)。

**Example:**
```json
{
  "scripts": {
    "test": "vitest run",
    "prepublishOnly": "npm test && publint"
  }
}
```

**什么情况会触发:** `npm publish` / `npm publish --dry-run` / `npm pack` 都会触发该钩子。注意 `npm version` **不会**触发 `prepublishOnly`。

### Anti-Patterns to Avoid

- **使用 `prepublish` 而非 `prepublishOnly`:** `prepublish` 已被弃用且会随 `npm install` 意外触发。必须使用 `prepublishOnly`。
- **在 `prepublishOnly` 中使用 `pnpm test`:** 使用 `npm test` 更可靠,因为 `npm publish` 始终通过 npm CLI 执行,`npm test` 确保使用正确的脚本解析器。
- **在 `prepublishOnly` 中使用 `npx publint`:** 如果 `publint` 在 devDependencies 中,`publint` 命令可直接运行(不需要 `npx`),因为 npm 会在 `node_modules/.bin/` 中找到它。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| npm 包质量验证 | 自己写脚本检查 package.json 字段 | `publint` | 社区标准工具,检查 exports/map、files、bin 等 20+ 项,避免手动遗漏 |
| 包发布前安全检查 | 手动审计发布内容 | `npm pack --dry-run` | 快速预览 tarball 包含哪些文件,排除意外泄漏 |
| 版本管理 | 手动编辑 `package.json` version | `npm version patch/minor/major` | 自动更新 package.json + git tag,保持版本一致性 |

**Key insight:** 这是一个纯配置/文档阶段,不需要手写任何运行时代码。最大的风险不在代码逻辑,而在**遗漏包配置**(如忘记移除 `private: true`、忘记补充 `repository` 字段)和**发布内容错误**(如意外包含测试目录)。

## Common Pitfalls

### Pitfall 1: 忘记移除 `private: true`
**What goes wrong:** `npm publish` 直接失败,因为 `private: true` 的包被禁止发布。
**Why it happens:** 开发过程中通常在 `package.json` 的 `private` 设置为 `true` 以防误发布。忘记在发布前移除。
**How to avoid:** 在发布流程中增加步骤:验证 `"private": false` 或移除该字段。
**Warning signs:** `npm publish` 报错 `"This package has been marked as private"`。

### Pitfall 2: `prepublishOnly` 脚本失败但未阻断发布
**What goes wrong:** 如果 `prepublishOnly` 脚本退出码不为 0,`npm publish` 会自动阻断——这是 npm 的内置行为。但需要确保脚本**真的会以非零退出码失败**。
**Why it happens:** 一些命令在失败时不会正确传播退出码(如 `test` 命令的拼写错误被 bash 吞掉)。
**How to avoid:** 使用 `&&` 连接命令(如 `npm test && publint`),而非 `;`。前者在第一个命令失败时中止。
**Warning signs:** 注意 `prepublishOnly` 应使用 `&&` 而不是 `;`。

### Pitfall 3: `files` 字段遗漏必要文件
**What goes wrong:** 发布后发现 `npm install -g ccusage-cn` 后 `ccusage-cn` 命令不可用,因为 `bin/cli.js` 不在 tarball 中。
**Why it happens:** `files` 字段只列出了 `bin/`、`src/`、`package.json`、`README.md`——这些是正确的。但未来新增文件时容易忘记更新 `files`。
**How to avoid:** 每次发布前运行 `npm pack --dry-run` 检查 tarball 内容。使用 `prepublishOnly` 脚本可以自动化这个检查。
**Warning signs:** `npm pack --dry-run` 显示的文件数量明显少于预期。

### Pitfall 4: 版本号策略不清
**What goes wrong:** 发布后发现版本号与上游 ccusage 混淆,或者 `^20.0.0` 依赖范围导致不兼容更新被自动拉取。
**Why it happens:** D-09 制定独立 SemVer,但开发中容易不自觉地与上游版本号对齐。
**How to avoid:** 明确在 README 和 CHANGELOG 中标注「ccusage-cn 使用独立版本号,不与上游版本号关联」。
**Warning signs:** 如果 `ccusage` 发布 21.0.0,`^20.0.0` 的 caret 范围会自动阻止更新——这是期望行为。

### Pitfall 5: 跨平台验证不足(Windows 路径问题)
**What goes wrong:** Linux 和 Windows 用户安装后运行失败,最常见的原因是路径分隔符或缓存目录权限。
**Why it happens:** Phase 1 仅在 macOS 上开发和测试。`binary-resolver.js` 使用 `createRequire(import.meta.url).resolve()` 解析二进制路径,这在 Node.js 上是跨平台兼容的,但未经过实际验证。
**How to avoid:** D-08 策略:Phase 2 声明兼容 + 文档注明已验证平台。等待 Phase 3 的 CI 矩阵做完整验证。代码层面,`utils.js` 已处理 `%LOCALAPPDATA%` 与 `~/.ccusage-cn` 的差异,`binary-resolver.js` 已处理 `.exe` 后缀。
**Warning signs:** Windows 用户报告 "ccusage native binary not found" 错误。

## Code Examples

### 完整的 npm 发布流程

```bash
# 1. 登录 npm (如果未登录)
npm whoami       # 检查当前登录状态
npm login        # 交互式登录

# 2. 设定初始版本号
npm version 1.0.0    # 首次发布
# 或后续更新:
npm version patch     # 1.0.0 → 1.0.1 (bugfix)
npm version minor     # 1.0.0 → 1.1.0 (新功能)
npm version major     # 1.0.0 → 2.0.0 (破坏性变更)

# 3. 预览 tarball 内容
npm pack --dry-run

# 4. 发布(自动触发 prepublishOnly)
npm publish --access public
```

### `package.json` scripts 配置

```json
{
  "scripts": {
    "test": "vitest run",
    "prepublishOnly": "npm test && publint"
  }
}
```

### 跨平台的 Node.js 环境检查(验证脚本)

用于在 macOS 上验证 Linux/Windows 兼容性的检查:

```javascript
// verify-platform.js — 验证跨平台配置
import process from 'node:process';
import { getNativePackageName } from '../src/binary-resolver.js';

const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64', 'win32-arm64'];

console.log('Cross-platform binary resolution check:');
for (const p of platforms) {
  const [platform, arch] = p.split('-');
  const name = getNativePackageName(platform, arch);
  const status = name ? 'OK' : 'MISSING';
  console.log(`  ${p}: ${status} → ${name || 'N/A'}`);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `prepublish` 生命周期钩子 | `prepublishOnly` 钩子 | npm v4 (2017) | `prepublish` 也在 `npm install` 时触发,导致不必要的构建 |
| `.npmignore` 黑名单 | `files` 字段白名单 | ES2015+ | `files` 白名单更精确,不易遗漏排除项 |
| 手动版本编辑 | `npm version` CLI | npm v2+ | 自动更新 package.json + git tag,减少人工错误 |
| CI 自动发布 | 手动发布 | 当前阶段(Phase 2) | Phase 3 将迁移到 CI 自动发布 |

**Deprecated/outdated:**
- `prepublish`: 已弃用,使用 `prepublishOnly` 替代
- `.npmignore`: 已过时,优先使用 `files` 白名单

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ccusage-cn` 包名在 npm 上尚未注册,发布时不会冲突 | Standard Stack | `npm view ccusage-cn` 返回 404,确认可用。无风险 |
| A2 | `npm whoami` 显示当前登录用户的 npm 账户 | Code Examples | 如果未登录,`npm publish` 会失败——属于正常的流程阻断,非风险 |
| A3 | 跨平台代码在非 macOS 上行为一致,无需 Phase 2 实际验证 | Common Pitfalls | D-08 已明确:Phase 2 仅声明兼容,完整验证矩阵留到 Phase 3 |
| A4 | `vitest` 的 [SUS] 标记是 slopcheck 误报 | Package Legitimacy Audit | vitest 是 Vite 团队维护的知名测试框架(16M+ 周下载),误报确认 |

## Open Questions (RESOLVED)

1. **[项目仓库 URL]** — RESOLVED: 在 Phase 2 使用占位 URL `git+https://github.com/user/ccusage-cn.git`，用户可在创建仓库后替换。不阻塞 Phase 2 发布。
   - 什么已知: D-11 要求填写 `repository` 和 `homepage` 字段
   - 什么不清楚: 项目 GitHub 仓库的具体 URL（当前未创建或未公开）
   - 决策: 使用占位 URL，计划中已实现（Task 1 step (e)）

## Environment Availability

> Phase 2 无外部服务依赖。发布流程仅依赖本地环境。

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm publish, vitest, publint | yes | 24.14.0 | — |
| npm | npm publish, npm test | yes | 11.9.0 | — |
| pnpm | 开发环境包管理 | yes | 10.32.1 | — |
| npm 登录状态 | npm publish | no (未登录) | — | 需要执行 `npm login` |

**Missing dependencies with no fallback:**
- npm 登录: 当前 `npm whoami` 报错未登录。发布前需要执行 `npm login`。

**Missing dependencies with fallback:** 无

## Validation Architecture

> `workflow.nyquist_validation` 在 `.planning/config.json` 中显式设置为 `false`,跳过此节。

## Security Domain

> `security_enforcement` 为 `true`。该 CLI 工具不涉及用户数据处理、认证、会话管理或网络服务器。安全评估如下。

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | 无用户认证 |
| V3 Session Management | no | 无会话管理 |
| V4 Access Control | no | 无访问控制 |
| V5 Input Validation | partial | `exchange-rate.js` 验证汇率 API 响应的 JSON 结构(验证 `data.usd.cny` 为 number 类型)。包装器不接收用户输入(参数逐字透传给上游) |
| V6 Cryptography | no | 无加密需求 |
| V7 Malicious Code Search | yes | `prepublishOnly` 验证发布内容;`files` 白名单限制发布范围 |
| V12 Secure File Storage | partial | 汇率缓存写入 `~/.ccusage-cn/cache/` 目录,写入权限由系统默认配置管理 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| npm 包发布意外包含敏感文件(测试、配置、凭证) | Information Disclosure | `files` 白名单 + `prepublishOnly` 运行 `publint` |
| 依赖替换攻击(安装恶意 ccusage-cn 变体) | Spoofing | 包名为 `ccusage-cn`,首次发布后 npm 会保护该名称。通过 `npm publish` 的 2FA 减少账户盗用风险 |
| CDN 汇率 API 返回恶意数据 | Tampering | 响应仅包含一个数值;类型检查(`typeof rate === 'number'`)防止注入。缓存文件是服务端 JSON,无执行风险 |

**安全总结:** 安全面较低——这是纯 CLI 工具,暴露面有限。主要风险是 npm 账户安全和发布内容控制,已在 `prepublishOnly` 和 `files` 白名单中解决。

## Sources

### Primary (HIGH confidence)
- **npm registry metadata for `ccusage-cn`**: `npm view ccusage-cn` 返回 404(包名可用)
- **npm registry metadata for `publint`**: v0.3.21, `npm view publint version`
- **npm registry metadata for `ccusage`**: v20.0.14, 6 个 platform optionalDependencies
- **npm registry metadata for upstream `ccusage devDependencies`**: `publint ^0.3.12`
- **npm pack --dry-run 验证**: 确认发布内容包含 7 个必要文件
- **slopcheck 扫描结果**: ccusage/publint [OK], vitest [SUS](假阳性), ccusage-cn [SLOP](预期)

### Secondary (MEDIUM confidence)
- **WebSearch: npm publish best practices 2026**: `prepublishOnly` 生命周期钩子用途和配置模式
- **WebSearch: publint v0.3.21 功能**: 检查 exports 映射、files 字段、bin 入口正确性
- **WebSearch: 常见 npm 发布陷阱**: `private: true` 忘记移除、版本号策略不清、跨平台路径问题

### Tertiary (LOW confidence)
- 无需要低置信度标记的项

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - 基于 npm registry 官方数据验证所有包名和版本
- Architecture: HIGH - 基于现有 Phase 1 源码结构和上游 ccusage 包分析
- Pitfalls: HIGH - 基于 WebSearch 确认的已知 npm 发布问题和已验证的代码分析

**Research date:** 2026-07-08
**Valid until:** 2026-08-08 (30 天 - 配置和元数据较为稳定,不依赖快速变化的 API)
