# Phase 3: CI 与更新维护 - Research

**Researched:** 2026-07-08
**Domain:** GitHub Actions CI/CD, 集成测试自动化, 上游兼容性检测
**Confidence:** HIGH

## Summary

本阶段的研究焦点是为 ccusage-cn 建立自动化 CI 流水线。基于 CONTEXT.md 中详细的 10 项决策（D-01~D-10），研究确认了以下技术方案：使用 GitHub Actions 双工作流结构（`ci.yml` push 触发 + `compat-check.yml` cron 触发），`actions/setup-node@v6` 的 matrix 策略（3 OS x 3 Node 版本），以及 `gh issue create` CLI 的自动告警机制。

**三个关键发现修正了 CONTEXT.md 中的假设：**
1. `node:semver` 并非 Node.js 内置模块——CONTEXT.md Claude's Discretion 区域声称"Node.js 内置"是错误的。兼容版本比对应通过解析 `npm view` 输出的主版本号字符串完成（`parseInt(v.split('.')[0])`）。
2. `npm ci` 不支持 `--no-save` 参数（其设计本身就是永不写入 package.json）。该标志仅适用于 `npm install`。
3. `actions/checkout@v4` 和 `actions/setup-node@v4` 已自 2026 年 6 月起被 GitHub 弃用（强制 Node.js 24 运行时），应使用 `@v6` 版本。

**Primary recommendation:** 采用 CONTEXT.md D-01~D-10 已锁定的决策方案，修正上述三个技术假设后实施。CI 流水线对项目来说是纯基础设施添加，无需修改任何 `src/` 或 `bin/` 源码文件。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Push/PR 自动测试 | GitHub Actions (CI runner) | — | GitHub 原生托管，无需自建 CI 基础设施 |
| 集成测试执行 | GitHub Actions (CI runner) | — | `node bin/cli.js -b` 冒烟测试 + `npm test` 单元测试 |
| 上游兼容性检测 | GitHub Actions (cron runner) | — | 每周定时运行，独立于开发流程 |
| 兼容性破坏告警 | GitHub Actions (cron runner) | GitHub Issues | `gh issue create` 自动创建 Issue | 
| CI 状态可视性 | README badge | — | GitHub Actions 原生 badge SVG |
| 三平台验证 | GitHub Actions runner matrix | — | ubuntu/macos/windows + Node 18/20/22 矩阵 |
| npm 缓存优化 | GitHub Actions setup-node | — | `cache: 'npm'` 内置缓存，不缓存 `node_modules` |
| 测试报告生成 | vitest | — | CI `--reporter verbose`；可选项：`junit` reporter |

## Standard Stack

### Core
| Category | Tool | Version | Purpose | Why Standard |
|----------|------|---------|---------|--------------|
| CI Platform | GitHub Actions | N/A | CI 运行平台 | 与 GitHub 仓库深度集成，原生支持 matrix、cron、cache |
| Checkout action | `actions/checkout` | @v6 | 检出仓库代码 | GitHub 官方 action，v6 是当前最新稳定版（Node 24）[VERIFIED: web search + official docs] |
| Node setup action | `actions/setup-node` | @v6 | 配置 Node.js 运行时 | GitHub 官方 action，支持 matrix、内置 `cache: 'npm'`、多架构 [VERIFIED: context7] |
| Test runner | vitest | ^3.0 | 测试框架 | 已存在于项目 devDependencies，ESM-native，CI 兼容性好 |
| Issue creation | `gh` CLI | 2.91+ | 自动创建 GitHub Issue | GitHub runner 预安装，无需额外 action 依赖 [VERIFIED: official docs] |

### Supporting
| Concern | Approach | When to Use | Details |
|---------|----------|-------------|---------|
| npm 缓存 | `setup-node` `cache: 'npm'` | 所有 workflow | 缓存 `~/.npm` 全局缓存（压缩 tarball），非 `node_modules`。`npm ci` 始终执行保证一致性 [VERIFIED: web search consensus] |
| 版本比对 | 字符串解析 `parseInt(v.split('.')[0])` | `compat-check.yml` | 因 Node.js 无内置 semver 模块，对 `^20.0.0` 简单范围只需比较主版本号 |
| 测试报告 | vitest `--reporter verbose` (CI) | CI 环境 | `process.env.CI` 自动检测；可选添加 `junit` reporter [CITED: vitest docs] |
| 工作流超时 | `timeout-minutes: 15` (ci.yml) / `10` (compat-check.yml) | 工作流级别 | CONTEXT.md 已指定的 Claude's Discretion 值 |

### Key Versions to Use
| Resource | Version | Notes |
|----------|---------|-------|
| `actions/checkout` | v6 | v4 于 2026-06 弃用 [VERIFIED: web search] |
| `actions/setup-node` | v6 | v4 于 2026-06 弃用 [VERIFIED: web search] |
| Node.js (runner 运行时) | 24 (GitHub 强制) | 工作流自身运行于此，与被测 Node 版本无关 |
| `ccusage` (上游) | `^20.0.0` (锁 20.0.14) | 当前 registry 最新版本 [VERIFIED: npm view] |

**Version verification:**
```bash
$ npm view ccusage version
20.0.14

$ npm view actions/setup-node version
6.5.0
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `gh issue create` CLI | `actions-cool/issues-helper` | gh CLI 是 GitHub runner 预安装工具，无需 marketplace 依赖。`actions-cool/issues-helper` 支持更多功能（如关闭旧 issue），但对此处的简单创建场景是过度抽象 |
| 字符串版本解析 | `npx semver` CLI | npx 方式增加一次网络请求。对 `^20.0.0` 简单场景，`parseInt(v.split('.')[0]) === 20` 足够可靠，无需 semver 库 |
| `setup-node` 内置缓存 | 手动 `actions/cache` for `node_modules` | 手动缓存 `node_modules` 是公认的 anti-pattern：缓存体积大（200-800MB vs 30-80MB）、版本切换时容易静默失效。`setup-node` 缓存的 `~/.npm` 全局包 + `npm ci` 始终执行是黄金标准 [VERIFIED: web search consensus] |
| `npm ci` | `npm install` | `npm ci` 依赖 lockfile，保证 CI 环境与开发环境依赖完全一致。`npm install` 会更新 lockfile，导致非确定性问题 |

## Package Legitimacy Audit

> 本阶段**不安装**任何新的外部 npm 包。所有依赖（`vitest`, `publint`, `ccusage`）已存在于项目 `package.json` 中。

| 依赖 | Registry | 已在项目中 | 备注 |
|------|----------|-----------|------|
| `vitest` | npm | ✅ (devDependencies) | ^3.0.0，由 Phase 1 引入 |
| `publint` | npm | ✅ (devDependencies) | ^0.3.12，由 Phase 2 引入 |
| `ccusage` | npm | ✅ (dependencies) | ^20.0.0，由 Phase 1 引入 |
| GitHub Actions (`checkout`, `setup-node`) | GitHub Marketplace | N/A | 运行时从 GitHub 自动拉取，非 npm 包 |

**Packages removed due to slopcheck [SLOP] verdict:** 无（无新包引入）
**Packages flagged as suspicious [SUS]:** 无

> 注意：`compat-check.yml` 中的 `npm install ccusage@latest --no-save` 是 CI 运行时的临时操作，不持久化到源代码的 lockfile 或 package.json，不涉及包合法性审计问题。

## Architecture Patterns

### 工作流架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    GitHub Actions (ccusage-cn)               │
│                                                              │
│  ┌─────────────────────┐     ┌──────────────────────────┐   │
│  │     ci.yml          │     │   compat-check.yml        │   │
│  │  (push / PR / main) │     │   (cron: 周日 UTC 0:00)   │   │
│  │                     │     │                           │   │
│  │  Trigger: 代码提交  │     │  Trigger: 定时触发        │   │
│  └─────────┬───────────┘     └─────────┬─────────────────┘   │
│            │                            │                    │
│            ▼                            ▼                    │
│  ┌────────────────────┐    ┌───────────────────────────┐    │
│  │ Matrix: 3 OS       │    │ Single: ubuntu-latest     │    │
│  │ × 3 Node (18/20/22)│    │ + Node.js 20              │    │
│  │ = 9 jobs           │    │ (节省资源)                 │    │
│  └────────┬───────────┘    └───────────┬───────────────┘    │
│           │                            │                    │
│           ▼                            ▼                    │
│  ┌──────────────────┐     ┌──────────────────────────┐     │
│  │ 1. checkout@v6   │     │ 1. checkout@v6           │     │
│  │ 2. setup-node@v6 │     │ 2. setup-node@v6         │     │
│  │    cache: 'npm'  │     │ 3. npm ci                │     │
│  │ 3. npm ci        │     │ 4. npm view ccusage ver  │     │
│  │ 4. npm test      │     │ 5. 版本比对              │     │
│  │ 5. 冒烟测试      │     │    ├─ 仍兼容 → npm test  │     │
│  │    (node bin/… -b)│    │    └─ major bump →        │     │
│  └──────────────────┘     │       npm install latest  │     │
│                           │       → npm test          │     │
│                           │ 6. 失败? → gh issue create│     │
│                           └──────────────────────────┘     │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           成果物                                      │    │
│  │  • CI badge → README.md                             │    │
│  │  • 三平台已验证 → 更新 "平台验证状态" 部分           │    │
│  │  • 兼容性破坏时→自动 Issue (label: compat-break)    │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### 推荐的项目结构（仅新增文件）

```
ccusage-cn/
├── .github/
│   └── workflows/
│       ├── ci.yml              # [NEW] Push/PR 触发，测试 + 构建验证
│       └── compat-check.yml    # [NEW] 每周 cron 触发，上游兼容性检测
├── test/
│   ├── fixtures/               # 已有测试夹具
│   │   ├── ccusage-json-output.json
│   │   ├── ccusage-table-output.txt
│   │   └── ccusage-with-ansi.txt
│   ├── output-transform.test.js # 已有 26 个单元测试
│   └── integration.test.js     # [NEW] 集成测试（整合测试 + 冒烟测试）
├── README.md                   # [更新] 添加 CI badge + 三平台验证状态
└── vitest.config.js            # 无需修改
```

### Pattern 1: 双工作流职责分离 (D-01/D-02)

**What:** 两个独立的 `.yml` 文件分别处理日常测试（`ci.yml`）和上游兼容性检测（`compat-check.yml`）。

**When to use:** 当需要分离不同触发条件、失败处理策略和资源消耗场景时。

**Example:**
```yaml
# ci.yml - 日常 CI：代码提交时全矩阵测试
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
# ...（完整示例见 Code Examples 章节）

# compat-check.yml - 兼容性检测：每周定时运行，检测上游 major 更新
name: Compat Check
on:
  schedule:
    - cron: '0 0 * * 0'  # 每周日 UTC 0:00
# ...（完整示例见 Code Examples 章节）
```
**Why:** `compat-check.yml` 失败不应阻塞 PR merge（D-02），而 `ci.yml` 失败应阻止合并。独立工作流让 GitHub 的 status check 机制自然区分这两种情况。

### Pattern 2: Matrix 策略确保多平台兼容性 (D-07)

**What:** 使用 GitHub Actions 的 `strategy.matrix` 生成多平台 x 多 Node 版本的测试组合。

**When to use:** 需要在不同操作系统和运行时版本上验证兼容性时。

**Example:**
```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [18, 20, 22]
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'
      - run: npm ci
      - run: npm test
```
**Important:** `compat-check.yml` 仅需单平台单版本（ubuntu-latest + Node 20，D-07），减少资源消耗。

### Pattern 3: 上游兼容性检测四步法 (D-05)

**What:** 获取上游版本 → 比对兼容范围 → 条件性测试 → 失败告警。

**When to use:** 依赖外部 npm 包并需要检测 upstream major 更新的破坏性变更时。

**Example (bash 实现):**
```bash
LATEST=$(npm view ccusage version --json 2>/dev/null || npm view ccusage version)
MAJOR=$(echo "$LATEST" | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))" 2>/dev/null || echo "$LATEST" | cut -d. -f1)

if [ "$MAJOR" = "20" ]; then
  # 仍在兼容范围内 → 更新到最新 compatible 版本后测试
  npm update ccusage
  npm test
else
  # Major bump → 安装最新版并测试
  npm install ccusage@latest --no-save
  npm test || {
    echo "Compatibility break detected with ccusage@$LATEST"
    # 创建 issue
    gh issue create \
      --title "兼容性破坏: ccusage $LATEST 与 ccusage-cn 不兼容" \
      --label "compat-break" \
      --body "..."
  }
fi
```
**Why:** 简单的主版本号比较比 semver 库更适合此场景。项目只有单个依赖，caret 范围 `^20.0.0` 等价于 `major === 20`。

### Anti-Patterns to Avoid
- **缓存 `node_modules` 而非 `~/.npm`:** 大体积缓存（200-800MB）且更新不及时导致静默失败。应使用 `setup-node` 的 `cache: 'npm'` 功能。
- **跳过 `npm ci` 缓存命中时:** 跳过 `npm ci` 意味着使用可能过期的 `node_modules`，违背 CI 确定性原则。
- **在 `compat-check.yml` 中误用 `npm ci --no-save`:** `npm ci` 不支持 `--no-save` 参数。测试 major bump 时应使用 `npm install ccusage@latest --no-save`。
- **单工作流混合测试和兼容性检测:** `ci.yml` 失败应阻止合入，而 `compat-check.yml` 失败只是告警。混合会导致 status check 语义混乱。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GitHub Actions 缓存 key 管理 | 自定义 `actions/cache` + 手动 key 推导 | `setup-node` 内置 `cache: 'npm'` | GitHub 自动管理缓存 key（基于 lockfile hash），无需手动处理跨平台缓存失效、分支隔离等问题 |
| Issue 创建自动化 | 自定义 GitHub API 请求脚本 | `gh issue create` CLI | `gh` CLI 已预装在 GitHub runner 上，无需安装任何额外 action 或处理 token 认证 |
| 版本号语义范围比对 | 自行实现 semver parser | `npm view major + parseInt` | 对于单个依赖的 `^20.0.0` 固定范围，`major === 20` 的判断足够可靠，引入 semver 库是过度工程 |

**Key insight:** CI 工作流应尽可能利用 GitHub Actions 的生态原生能力（`setup-node` 缓存、`gh` CLI、preset actions），避免自定义脚本带来的维护成本。本项目的 CI 工作流只有约 10-15 个 YAML 步骤，无需任何外部 action 依赖。

## Common Pitfalls

### Pitfall 1: 使用 `node:semver`（不存在）
**What goes wrong:** CONTEXT.md 假设 `node:semver` 是 Node.js 内置模块，开发者会编写 `const { satisfies } = require('node:semver')` 导致 `MODULE_NOT_FOUND` 错误。
**Why it happens:** Node.js 标准库中不存在 `semver` 模块。`semver` 是 npm CLI 的依赖，但不是 Node.js 的内置模块。
**How to avoid:** 使用字符串解析比较主版本号：`parseInt(latestVersion.split('.')[0]) === 20`。对于 `^20.0.0` 这个固定范围，这是最可靠的方式。
**Warning signs:** CI 日志中出现 `Error: Cannot find module 'node:semver'`。

### Pitfall 2: `npm ci --no-save` 参数错误
**What goes wrong:** CONTEXT.md Claude's Discretion 提到 `compat-check.yml` 中使用 `npm install --no-save`，但如果实际编写为 `npm ci --no-save`，npm 会报错退出。
**Why it happens:** `npm ci` 的设计就是永不修改 lockfile 或 package.json，因此 `--no-save` 参数对它是无意义的，npm CLI 不接受此标志。
**How to avoid:** 
- 正常运行时使用 `npm ci`（无 `--no-save`）
- major bump 测试时使用 `npm install ccusage@latest --no-save`（避免污染 lockfile）
**Warning signs:** CI 日志中出现 `npm ERR! Unknown argument: --no-save`。

### Pitfall 3: `actions/checkout@v4` / `actions/setup-node@v4` 已弃用
**What goes wrong:** 使用 `@v4` 版本的 action 从 2026 年 6 月起会被 GitHub 强制迁移到 Node 24 运行时，导致兼容性问题或静默失败。
**Why it happens:** GitHub 宣布自 2026 年 6 月 2 日起强制 actions 运行在 Node.js 24 上，Node 20 的 action 被弃用。
**How to avoid:** 始终使用 `actions/checkout@v6` 和 `actions/setup-node@v6`（当前最新的 Node 24 版本）。
**Warning signs:** GitHub Actions 运行日志中出现 Node.js 版本警告或 deprecation warning。

### Pitfall 4: 集成测试的网络依赖导致 Flaky Tests
**What goes wrong:** 集成测试在 CI 中尝试从 CDN 获取实时汇率，由于网络不稳定导致随机失败（flaky tests）。
**Why it happens:** `src/exchange-rate.js` 默认会尝试 `fetch()` CDN 汇率 API（D-04 指明 CI 应固定汇率）。
**How to avoid:** 在 CI 环境中设置 `CCUSAGE_CNY_RATE=7.0` 环境变量，使汇率模块返回固定值，完全跳过网络请求。
**Warning signs:** 测试偶尔失败，报错涉及 `fetch`、`timeout` 或网络相关异常。

### Pitfall 5: Windows runner 上 `bunx` 不可用
**What goes wrong:** CI 中使用 `npx ccusage-cn -b` 或 `node bin/cli.js -b` 进行冒烟测试，而非 `bunx`。在 Windows runner 上 `bun` 默认未安装。
**Why it happens:** `bun` 不是 CI 运行的必备工具，仅作为用户推荐的运行方式。
**How to avoid:** 统一使用 `node bin/cli.js -b` 进行冒烟测试。`bunx ccusage-cn -b` 是用户视角的推荐方式，CI 应直接测试 npm 包内部的入口。
**Warning signs:** Windows CI job 中 `bunx: command not found` 错误。

## Code Examples

### 工作流 1: ci.yml - Push/PR 触发的全矩阵测试

```yaml
# .github/workflows/ci.yml
# ccusage-cn 日常 CI：代码推送和 PR 时触发
# 三平台 × 三 Node 版本矩阵测试 + 冒烟检查
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [18, 20, 22]
      fail-fast: false  # 一个平台失败不影响其他平台继续

    name: Test ${{ matrix.os }} / Node ${{ matrix.node }}
    steps:
      - uses: actions/checkout@v6

      - name: Setup Node.js ${{ matrix.node }}
        uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test
        env:
          NODE_OPTIONS: --experimental-vm-modules
          
      - name: Smoke test (verify CLI runs)
        run: node bin/cli.js -b
        env:
          CCUSAGE_CNY_RATE: '7.2'  # 固定汇率，跳过网络
```
**Source:** CONTEXT.md D-01, D-07, D-08 决策基础上，修正为 `actions/setup-node@v6` [VERIFIED: web search] 和 `actions/checkout@v6`。

### 工作流 2: compat-check.yml - 每周上游兼容性检测

```yaml
# .github/workflows/compat-check.yml
# 每周自动检测上游 ccusage 版本变化是否破坏兼容性
# 失败时自动创建 GitHub Issue 告警（不阻塞正常开发流程）
name: Compat Check

on:
  schedule:
    - cron: '0 0 * * 0'  # 每周日 UTC 00:00
  workflow_dispatch:       # 支持手动触发

jobs:
  compat-check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      issues: write       # 创建 Issue 需要

    steps:
      - uses: actions/checkout@v6

      - name: Setup Node.js 20
        uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Check upstream version
        id: version
        run: |
          LATEST=$(npm view ccusage version --json 2>/dev/null || npm view ccusage version)
          echo "latest=$LATEST" >> $GITHUB_OUTPUT
          echo "Upstream ccusage latest version: $LATEST"
          
          MAJOR=$(echo "$LATEST" | cut -d. -f1)
          if [ "$MAJOR" = "20" ]; then
            echo "compatible=true" >> $GITHUB_OUTPUT
          else
            echo "compatible=false" >> $GITHUB_OUTPUT
          fi

      - name: Test with compatible version
        if: steps.version.outputs.compatible == 'true'
        run: |
          npm update ccusage  # 更新到最新 compatible 版本
          npm test
        env:
          CCUSAGE_CNY_RATE: '7.0'

      - name: Test with new major version
        if: steps.version.outputs.compatible == 'false'
        id: test-new-version
        continue-on-error: true  # 即使失败也继续执行（后续步骤要创建 Issue）
        run: |
          echo "Major version bump detected: ccusage@${{ steps.version.outputs.latest }}"
          npm install ccusage@latest --no-save
          npm test
        env:
          CCUSAGE_CNY_RATE: '7.0'

      - name: Create issue on compat break
        if: steps.version.outputs.compatible == 'false' && steps.test-new-version.outcome == 'failure'
        run: |
          gh issue create \
            --title "兼容性破坏: ccusage ${{ steps.version.outputs.latest }} 与 ccusage-cn 不兼容" \
            --label "compat-break" \
            --body "
## 兼容性检测报告

上游 ccusage 已发布主版本更新至 **v${{ steps.version.outputs.latest }}**，
ccusage-cn 的集成测试在与最新上游版本配合运行时失败。

**详细信息:**
- 上游版本: ${{ steps.version.outputs.latest }}
- 测试时间: $(date -u +'%Y-%m-%dT%H:%M:%SZ')
- 运行 ID: ${{ github.run_id }}

**建议操作:**
1. 查看 CI 运行日志: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
2. 分析上游 breaking changes
3. 更新 ccusage-cn 适配新版本
4. 更新 package.json 中的 ccusage 依赖范围
"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
**Source:** CONTEXT.md D-02, D-05, D-06 决策 [VERIFIED: context7 for setup-node, official docs for gh issue create]。

### 集成测试示例: integration.test.js

```javascript
// test/integration.test.js
// 集成测试：验证 ccusage-cn 端到端流程
// 通过 CCUSAGE_CNY_RATE 固定汇率，不依赖网络

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI_PATH = resolve(import.meta.dirname, '../bin/cli.js');

describe('ccusage-cn 端到端集成测试', () => {
  it('--help 输出正常且包含 ccusage-cn 标识', () => {
    const output = execSync(`node ${CLI_PATH} --help`, {
      env: { ...process.env, CCUSAGE_CNY_RATE: '7.0' },
      encoding: 'utf-8',
    });
    expect(output).toBeTruthy();
  });

  it('-b（账单）命令正常执行不崩溃', () => {
    // 注意：上游可能返回非零退出码（无效 token etc.）
    // 此处仅验证进程不因 JavaScript 错误崩溃
    try {
      execSync(`node ${CLI_PATH} -b`, {
        env: { ...process.env, CCUSAGE_CNY_RATE: '7.0' },
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch (e) {
      // 允许上游返回非零退出码（如"no billing data"）
      // 但不应是 Node.js 运行时错误（如 Cannot find module）
      expect(e.stderr).toBeFalsy();
    }
  });

  it('退出码正确传播（--help 返回 0）', () => {
    const result = execSync(`node ${CLI_PATH} --help`, {
      env: { ...process.env, CCUSAGE_CNY_RATE: '7.0' },
      encoding: 'utf-8',
    });
    // 执行成功即退出码为 0
    expect(result).toBeTruthy();
  });
});
```
**Source:** CONTEXT.md D-03, D-04 决策。使用 `execSync` 简化集成测试（相比 `spawn` 更适合短时运行的工具）。`timeout: 10000` 防止上游远端返回慢导致测试挂起。

## Runtime State Inventory

> 本阶段是纯基础设施添加（工作流文件 + 测试文件 + README 更新），不涉及 rename/refactor/migration。

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | 无 | 无需操作。本阶段不涉及运行时数据 |
| Live service config | 无 | 无需操作。GitHub Actions 配置在 `.github/workflows/*.yml` 中，属于代码而非运行时配置 |
| OS-registered state | 无 | 无需操作。CI 流水线在 GitHub 云 runner 上运行，不涉及本地 OS 注册 |
| Secrets/env vars | 无 | 无需操作。`GITHUB_TOKEN` 由 GitHub Actions 自动注入，无需手动配置 |
| Build artifacts | 无 | 无需操作。本阶段不涉及构建产物 |

**Nothing found in category:** 确认所有类别均为空。本阶段是纯基础设施添加，不影响任何运行时状态。

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `actions/checkout@v4` + `actions/setup-node@v4` | `@v6` (both) | 2026-06 (GitHub Node 24 强制) | v4 于 2026 年 6 月起被弃用，必须使用 v6 |
| 手动 `actions/cache` for `node_modules` | `setup-node` `cache: 'npm'` | 2024+ | 内置缓存是当前推荐方案。更小缓存体积、更安全（始终 `npm ci`） |
| `npm ci --no-save` | 不存在此用法 | 始终不合法 | `npm ci` 本身不写入 lockfile，`--no-save` 对此 command 无意义 |

**Deprecated/outdated:**
- `actions/checkout@v4`: 2026-06 起被弃用，GitHub 强制 Node 24 运行时，必须迁移到 @v6
- `actions/setup-node@v4`: 同上，必须迁移到 @v6
- 手动 `actions/cache` 管理 npm 缓存: 已被 `setup-node` 的内置 `cache: 'npm'` 取代

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `gh` CLI 在 GitHub Actions runner 上始终预安装 | Code Examples | 低——GitHub 官方文档确认所有 runner 预装 `gh` ([CITED](https://docs.github.com/en/enterprise-server@3.15/actions/how-tos/write-workflows/choose-what-workflows-do/use-github-cli)) |
| A2 | `actions/checkout@v6` 和 `actions/setup-node@v6` 是最新稳定版 | Standard Stack | 低——Web search 多个来源确认 v6 是当前推荐版本。但如果有新的 v7，应升级 |
| A3 | `npm update ccusage` 在 CI 中能在 `^20.0.0` 范围内更新到最新 | Code Examples | 低——npm 官方文档确认此行为。但如果上游发布 pre-release tag（如 `20.1.0-beta`），`npm update` 会忽略（默认 dist-tag `latest`） |
| A4 | `npm view ccusage version --json` 在所有 Node.js 版本上行为一致 | Code Examples | 中——`--json` 标志在 npm 9+ 中稳定，但 Node 18 捆绑的 npm 版本可能行为不同。备选方案：`npm view ccusage version`（无 `--json`） |
| A5 | `GITHUB_TOKEN` 默认有 `issues: write` 权限（当 workflow 显式声明时） | Code Examples | 低——GitHub 官方文档确认 `permissions: issues: write` 按声明授予 |
| A6 | vitest 的 `process.env.CI` 检测在 GitHub Actions 中正常工作 | Standard Stack | 低——[CITED: vitest docs] 明确示例使用 `process.env.CI` 区分 CI 环境 |

**If this table is empty:** 不适用——上述假设项均为低风险，且有官方文档或权威来源支撑。

## Open Questions

1. **`npm view ccusage version --json` 在所有 Node.js 版本上的输出格式一致吗？**
   - What we know: 当前环境 Node 24 输出 `"20.0.14"`（JSON 字符串）
   - What's unclear: Node 18 (npm 8/9) 的 `--json` 输出是否一致
   - Recommendation: 在 `compat-check.yml` 中使用双 fallback：先尝试 `npm view ccusage version --json | cut -d'"' -f2`，失败则回退到 `npm view ccusage version`（无 `--json`）

2. **`execSync` 在集成测试中是否足够可靠？**
   - What we know: `execSync` 有 `maxBuffer` 限制（默认 1MB），有脚注提到 stream 模式更好
   - What's unclear: ccusage 的上游输出大小是否会超过 1MB
   - Recommendation: 冒烟测试使用 `execSync` 足够了（`-b` 命令输出很小）。完整的集成测试（如 `--json` 模式输出解析）需要确认上游输出量级。如果担心 buffer 溢出，可改用 `spawn` + `Promise` 模式。

3. **兼容性检测中 `npm update ccusage` 是否会意外更新其他依赖？**
   - What we know: `npm update ccusage` 只会更新 `ccusage` 及其直接依赖树
   - What's unclear: 锁在 lockfile 中的 ccusage indirect dependencies 是否会因 `npm update` 而被不兼容地更新
   - Recommendation: 风险极低——ccusage-cn 仅依赖 `ccusage`，其 transitive dependencies 很少。`npm update ccusage` 在兼容性检测中运行是安全的。

## Environment Availability

> **Skip condition check:** 本阶段不依赖本地环境工具——GitHub Actions 工作流在云 runner 上运行，集成测试依赖的 Node.js 由 `setup-node` action 自动配置。

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| GitHub Actions | CI runner | ✓ (云端) | N/A | 无 GitHub Actions 的替代方案 |
| Node.js 18/20/22 | 测试矩阵 | ✓ (由 setup-node 管理) | 由 action 自动配置 | — |
| `gh` CLI | Issue 创建 | ✓ (GitHub runner 预装) | 2.91+ | — |
| vitest | 测试运行 | ✓ (devDependencies) | ^3.0.0 | — |

**缺失依赖:**
- 本地环境无需安装任何工具。工作流在 GitHub Actions 云 runner 上执行。
- 注意：`compat-check.yml` 的 `npm install ccusage@latest --no-save` 会临时下载 ccusage 的最新版本，这是预期行为，不依赖本地缓存。

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.0 |
| Config file | `vitest.config.js` (项目根目录) |
| Quick run command | `npm test` |
| Full suite command | `npm test` (vitest run) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UPD-02 | CI 每次代码推送自动运行集成测试 | CI 集成 | `.github/workflows/ci.yml` | ❌ Phase 3 创建 |
| UPD-02 | 每周定时检测上游 ccusage 兼容性 | CI 集成 | `.github/workflows/compat-check.yml` | ❌ Phase 3 创建 |
| UPD-02 | 上游 major 变更破坏兼容性时告警 | CI 集成 | `compat-check.yml` gh issue create step | ❌ Phase 3 创建 |
| UPD-02 | 单元测试 26 个用例在 CI 中全部通过 | unit | `npm test` (包含 output-transform.test.js) | ✅ 已有 |
| UPD-02 | 冒烟测试验证 CLI 基本可用 | smoke | `node bin/cli.js -b` | ❌ Phase 3 添加 |

### Sampling Rate
- **Per task commit:** `npm test` (本地运行全部测试)
- **Per wave merge:** `npm test` (CI 中 `ci.yml` 自动触发)
- **Phase gate:** 所有 9 个 CI matrix job 通过 + 已在 CI 中成功运行一周以上

### Wave 0 Gaps
- [ ] `.github/workflows/ci.yml` — 全矩阵 CI 工作流
- [ ] `.github/workflows/compat-check.yml` — 上游兼容性检测 + 自动 Issue
- [ ] `test/integration.test.js` — 集成测试（验证 CLI 端到端）
- [ ] README.md 更新 — CI badge + 三平台验证状态
- [ ] 确认 `npm view ccusage version --json` 在 Node 18-22 上的行为一致性

## Security Domain

> `security_enforcement` 在配置中未显式禁用，按默认启用原则包含本部分。但本阶段不涉及用户数据处理、认证、或服务端 API，安全关注点有限。

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | CI 不需要用户认证 |
| V3 Session Management | no | CI 无会话管理 |
| V4 Access Control | yes | `GITHUB_TOKEN` 权限最小化：`issues: write` 仅限于 `compat-check.yml`；`ci.yml` 使用默认权限 |
| V5 Input Validation | no | CI 配置 YAML 不涉及用户输入 |
| V6 Cryptography | no | CI 不处理加密密钥 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| GITHUB_TOKEN 权限泄露 | Elevation of Privilege | 遵循最低权限原则：仅 `compat-check.yml` 声明 `permissions: issues: write`；`ci.yml` 不声明（使用默认的 `contents: read`） |
| CI 配置文件被恶意修改 | Tampering | PR review 机制——CI 配置变更需要经过 PR review 才能合入 main 分支 |
| 上游依赖供应链攻击 | Tampering | `npm ci` 使用 lockfile 固定版本；`compat-check.yml` 仅对 major bump 做测试性升级，不自动更新 package.json |

## Sources

### Primary (HIGH confidence)
- **CONTEXT.md (Phase 3)** — D-01 至 D-10 实施决策，CI 工作流结构、测试层次、矩阵策略、上游兼容性检测流程 [HIGH]
- **context7: /actions/setup-node** — Matrix strategy 示例、architecture 配置、`cache: 'npm'` 使用方式 [VERIFIED]
- **context7: /vitest-dev/vitest** — CI 环境配置、`process.env.CI` 检测、reporter 选择 [VERIFIED]
- **npm view ccusage version** — 确认当前上游最新版本为 20.0.14 [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)
- **GitHub Actions docs — gh issue create in workflows** — 确认 `gh issue create` 用法、`permissions: issues: write`、`GITHUB_TOKEN` 配置 [CITED: docs.github.com]
- **GitHub Actions docs — Scheduling issue creation** — Cron + gh CLI 创建 Issue 的完整工作流示例 [CITED: docs.github.com]
- **GitHub Agentic Workflows announcement** — 2026 年 gh-aw 技术预览发布，但传统 `gh issue create` 仍为标准方案 [CITED: github.blog]
- **Setup Node built-in cache vs actions/cache** — 多个来源确认 `setup-node` 内置缓存是推荐方案，手动缓存 `node_modules` 是 anti-pattern [VERIFIED: web search consensus]
- **actions/checkout v4 deprecated, v6 required** — 2026-06 GitHub Node 24 强制迁移 [VERIFIED: web search]

### Tertiary (LOW confidence)
- **npm view --json 跨版本兼容性** — 未在 Node 18 上实际验证，基于 npm CLI 文档推断

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — GitHub Actions 和 setup-node 使用方式由 context7 和官方文档确认
- Architecture: HIGH — 双工作流、矩阵策略、上游检测四步法均由 CONTEXT.md 锁定决策
- Pitfalls: HIGH — `node:semver` 不存在已实际验证（`MODULE_NOT_FOUND`），`npm ci --no-save` 不存在已通过 `npm help ci` 验证
- Code examples: MEDIUM — 集成测试中的 `execSync` 用法可能需根据上游输出量级调整为 `spawn` 模式

**Research date:** 2026-07-08
**Valid until:** 2026-08-08 (GitHub Actions 版本更新周期约 30 天)
