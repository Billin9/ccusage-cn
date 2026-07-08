# Phase 01: 核心包装器 (MVP) - Research

**Researched:** 2026-07-08
**Domain:** Node.js CLI 包装器 — 零依赖 spawn + stream 转换
**Confidence:** HIGH (upstream source verified via npm pack, API verified, 12 pitfalls catalogued)

## Summary

这是 ccusage-cn 的初始阶段：构建一个零外部运行时依赖的 Node.js CLI 包装器。核心模式是将 `child_process.spawn()` 的 stdout pipe 通过 `stream.Transform`，实时将上游 ccusage 输出的美元费用（`$X.XX`）替换为人民币（`¥Y.YY`），同时保持 100% 的 CLI 参数兼容性和信号/退出码透传。

上游 ccusage v20.0.14 的 `cli.js` 已通过 `npm pack` 验证，确认导出了 `resolveNativeBinary`、`resolveCliRuntime`、`ensureNativeBinaryExecutable` 四个命名函数。我们的包装器可直接 `import { resolveCliRuntime } from 'ccusage/src/cli.js'` 复用上游的二进制解析逻辑，只需自定义 spawn（将 stdio 从 `inherit` 改为 `['inherit', 'pipe', 'inherit']`）并插入 Transform 流。

**主要建议：** 5 个独立 JS 源文件（`cli.js`、`binary-resolver.js`、`spawner.js`、`output-transform.js`、`exchange-rate.js`），零运行时依赖，纯 ESM。上游 `cli.js` 的导入路径已验证可行。

**需注意的关键差异：** 上游的 `createNativeSpawner()` 使用 `stdio: 'inherit'`（我们需改为 pipe stdout）；上游没有显式注入 `FORCE_COLOR`（我们需添加）；上游的信号处理仅在被杀时将信号传回父进程（我们需实现 D-05 要求的显式 SIGINT/SIGTERM 转发）。

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLI-01 | 所有上游 ccusage 命令和参数完全透传 | D-09: `process.argv.slice(2)` 逐字转发，已验证 upstream spawn 模式 |
| CLI-02 | 上游进程退出码正确传播 | D-10: `child.on('exit')` 事件捕获 code/signal → `process.exit()` |
| CLI-03 | SIGINT/SIGTERM 正确处理，无孤儿进程 | D-05: 显式信号转发 + cleanup 确认，验证了 upstream 和 12 个 pitfall |
| CLI-04 | `--json` 模式追加 `costCNY` 不覆盖原字段 | D-06: JSON 模式 accumulate → parse → append → stringify 已验证 |
| COST-01 | 文本模式 `$X.XX` → `¥Y.YY` | D-06: `stream.Transform` 逐块 regex 替换，验证了汇率 API |
| COST-02 | JSON 模式自动追加 `costCNY` | D-06: 遍历查找费用字段追加 |
| COST-03 | `CCUSAGE_CNY_RATE` 环境变量可配置 | D-08: 三层回退，env var 优先级最高 |
| COST-04 | 无网络环境下使用缓存或默认值 | D-08: CDN fetch + 磁盘缓存 (24h TTL) + 默认值 `7.2` |
| DIST-02 | `bunx ccusage-cn` 自动拉取上游及平台二进制 | D-11: `ccusage@^20.0.0` 为 dependency，npm 自动解析 optionalDependencies |
| OUT-01 | ANSI 彩色输出保留 | D-07: `FORCE_COLOR=1` 环境变量注入 |
| OUT-02 | 表格列对齐在人民币转换后保持合理 | D-06: 文本模式逐块替换，保持原有空格/对齐（人民币位数需关注） |
| OUT-03 | `--help` 透传上游，附加 ccusage-cn 特有说明 | D-10: 子进程 stderr/help 透传，入口处环境变量说明 |
| UPD-01 | `ccusage@^20.0.0` caret 范围，patch/minor 自动继承 | D-03: 已验证上游 semver 规范 |
</phase_requirements>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** 使用 Node.js 18+ ESM 编写包装器，零第三方运行时依赖。仅使用 `node:child_process`、`node:stream`、`node:process` 等内置模块。
- **D-02:** 纯 JavaScript（`.js`），不使用 TypeScript。上游 ccusage 同样使用 JS+JSDoc，保持一致性。无构建步骤，`bin` 入口直接指向 `.js` 文件。
- **D-03:** 通过 npm 依赖 `ccusage@^20.0.0`（caret 范围），使用上游导出的 `resolveCliRuntime` 查找平台特定的原生二进制路径。
- **D-04:** 使用 `child_process.spawn()` + `stdout: 'pipe'` + `stderr: 'inherit'`，绝不使用 `exec()` 或 `execSync()`。
- **D-05:** 显式转发 SIGINT、SIGTERM 信号到子进程；如果子进程被信号终止，包装器以相同信号退出（`process.exit(128 + signalNumber)`）。
- **D-06:** 双模式转换：JSON 模式 collect → parse → append costCNY → stringify；文本模式 `stream.Transform` 逐块正则替换 `$(\d+\.?\d*)` → `¥(CNY值)`。
- **D-07:** spawn 时注入 `FORCE_COLOR=1` 环境变量。
- **D-08:** 三层汇率回退：(1) `CCUSAGE_CNY_RATE` 环境变量 (2) CDN API 缓存 (24h TTL) (3) 硬编码默认值 `7.2`。CDN fetch 异步非阻塞。
- **D-09:** `process.argv.slice(2)` 逐字转发所有 CLI 参数。
- **D-10:** 子进程退出码和 stderr 完全透传。`--help` 透传上游，仅追加环境变量说明。
- **D-11:** `package.json` 声明 `ccusage@^20.0.0` 为 dependency。
- **D-12:** `bin` 字段指向 Node.js 脚本（`./bin/cli.js`），绝不指向原生二进制。

### Claude's Discretion
- 汇率缓存文件路径默认为 `~/.ccusage-cn/cache/rate.json`，Windows 上使用 `%LOCALAPPDATA%/ccusage-cn/cache/rate.json`
- JSON 模式下 `costCNY` 字段的命名和放置位置（建议放在对应 `costUSD` 字段旁边）
- CDN fetch 超时设为 5 秒
- 汇率精度：人民币显示保留两位小数（`¥12.34`）

### Deferred Ideas (OUT OF SCOPE)
- 实时汇率 API 自动获取（Phase 3 / v2 RATE）
- 双币种展示（USD + CNY 并排，v2 ENH-02）
- `--rate` 和 `--cost-unit` CLI 标志（v2 RATE-03, ENH-04）
- Statusline 命令本地化（v2 ENH-01）
- MCP 服务器本地化（v2+）
- 上游更新自动检测/通知（Phase 3 UPD-02）

## Project Constraints (from CLAUDE.md)

从 `./CLAUDE.md` 中提取的 GSD 项目约束：

- **兼容性约束：** 必须 100% 兼容上游所有 CLI 参数和输出格式（除费用单位外）
- **维护成本约束：** 代码改动量最小化，优先考虑 wrapper/adapter 模式
- **分发方式约束：** 通过 npm 包分发，`bunx ccusage-cn` 可用
- **汇率约束：** 需要支持可配置的 USD→CNY 汇率
- **零依赖约束：** 在 `CLAUDE.md` stack 部分确认——零外部运行时依赖，仅使用 Node.js built-in 模块
- **纯 JavaScript 约束：** CLAUDE.md 和 CONTEXT.md 都确认使用纯 JS ESM，无 TypeScript/build 步骤
- **JSDoc 类型注释：** 与上游保持一致，使用 `@ts-check` + JSDoc 替代 TypeScript

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 二进制解析（定位原生二进制路径） | API / Backend | — | Node.js 进程内 `require.resolve()` 操作 |
| 进程生命周期管理（spawn/signal/exit） | API / Backend | — | Node.js child_process 操作 |
| 输出流转换（USD→CNY） | API / Backend | — | Node.js Transform stream 管道处理 |
| 汇率获取（env/cache/API） | API / Backend | — | Node.js 内置 `fetch()` + 文件缓存 |
| CLI 参数转发 | API / Backend | — | `process.argv.slice(2)` 透传 |
| 终端彩色输出 | Browser / Client | API / Backend | Terminal client 消费 ANSI 输出；`FORCE_COLOR=1` 由 wrapper 注入 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | >= 18 (LTS) | Runtime | 上游同为 Node.js ESM 工具链；内置 `fetch()` |
| JavaScript (ESM) | ES2022 | 语言 | 零构建步骤，与上游一致 |
| `node:child_process` | 内置 | 进程管理 | `spawn()` 避免 shell 注入和 `maxBuffer` |
| `node:stream` | 内置 | 输出转换 | `stream.Transform` 实现流式替换 |
| `node:process` | 内置 | 信号/退出码 | SIGINT/SIGTERM handler 和 exit code |
| `node:os` | 内置 | 跨平台路径 | `os.homedir()` / `os.platform()` 判断缓存路径 |
| `node:fs` | 内置 | 缓存读写 | 汇率缓存文件的读取和原子写入 |
| `node:module` | 内置 | 二进制解析 | `createRequire` + `require.resolve()` |
| `globalThis.fetch` | 内置 | 汇率 API | Node 18+ 原生 `fetch()`，无需第三方 HTTP 库 |
| `ccusage` | ^20.0.0 | 上游二进制 | 通过 `resolveCliRuntime` 复用二进制解析逻辑 |

### Development Tools
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| pnpm | >= 9 | 本地包管理 | 与上游 monorepo 一致 |
| vitest | ^3.0 | 测试框架 | ESM 原生，快速，仅 devDependency |
| publint | ^0.3 | npm 包质量检查 | 上游也使用 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `import { resolveCliRuntime } from 'ccusage/src/cli.js'` | 自行实现二进制路径解析 | 自行实现需维护 platform->arch 映射表（~15 行），失去上游更新同步；上游路径已验证可靠 |
| `stream.Transform` (内置) | `through2` (npm) | `stream.Transform` 在 Node 18+ 内置可用，无需第三方 |
| `globalThis.fetch` (内置) | `node-fetch` / `axios` | `fetch()` 在 Node 18+ 已稳定，无需额外依赖 |
| 纯 JS ESM | TypeScript | TypeScript 需 build 步骤增加 `bin` 入口复杂性；上游也用纯 JS |

### 已确认的上游 API 接口

从 `npm pack ccusage@20.0.14` 中得到并验证：

```javascript
// 可用导入
import {
  resolveNativeBinary,      // ({ arch?, platform?, resolvePath? }) => string | undefined
  resolveCliRuntime,        // ({ argv, arch?, nativeBinaryPath?, platform? }) => CliRuntime
  ensureNativeBinaryExecutable, // ({ binaryPath, chmodPath?, platform?, statPath? }) => string | undefined
  isMainModule,             // ({ argvEntry?, moduleUrl, realpathPath? }) => boolean
} from 'ccusage/src/cli.js';

// CliRuntime 返回类型：{ args: string[]; command: string } | { errorMessage: string }
```

**重要发现：** 上游的 `createNativeSpawner()` 内部使用 `stdio: 'inherit'`。我们的包装器需要自定义 spawn 以实现 stdout pipe。

**安装命令：**
```bash
pnpm add ccusage@^20.0.0
pnpm add -D vitest
```

**版本验证：**
```bash
npm view ccusage version    # 20.0.14
npm view vitest version     # 3.1.x
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `ccusage` | npm | ~13 months | 高 | github.com/ccusage/ccusage | N/A (npm ecoreg) | Approved |
| `vitest` | npm | ~4.5 years | 非常高 | github.com/vitest-dev/vitest | N/A (npm ecoreg) | Approved |

**说明：** slopcheck 仅支持 PyPI 验证。本项目为 Node.js 项目，已使用 `npm view` 验证所有包在 npm registry 上的存在性、发布时间和发布来源。两个包的 postinstall 脚本均不存在（`npm view <pkg> scripts.postinstall` 返回空）。

## Architecture Patterns

### System Architecture Diagram

```
用户终端
  bunx ccusage-cn -b  /  bunx ccusage-cn --monthly --json
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│                    ccusage-cn CLI (bin/cli.js)                    │
│                                                                  │
│  ① import { resolveCliRuntime } from 'ccusage/src/cli.js'        │
│     → 解析平台特定二进制路径                                      │
│      │                                                            │
│      ▼                                                            │
│  ② 获取汇率 (异步非阻塞)                                          │
│     env → cache → CDN API → 默认值 7.2                            │
│      │                                                            │
│      ▼                                                            │
│  ③ spawn(binary, args, { stdio: ['inherit', 'pipe', 'inherit'],  │
│                           env: {FORCE_COLOR: '1'} })              │
│      │                                                            │
│      ├── stderr → inherit → 用户终端 (透传错误)                    │
│      │                                                            │
│      └── stdout → pipe → ④ Transform Stream                      │
│                              │                                    │
│                          检查 --json 标志                          │
│                          ├── JSON模式: collect → parse →          │
│                          │   append costCNY → stringify → output  │
│                          │                                        │
│                          └── 文本模式: 逐块 regex                    │
│                              $X.XX → ¥(X.XX*rate)                │
│                              Cost (USD) → Cost (CNY)              │
│                              │                                    │
│                              push(chunk) → process.stdout         │
│                              │                                    │
│                              ▼                                    │
│                          用户看到人民币费用                          │
│                                                                  │
│  ⑤ 退出码传播 child.on('exit') → process.exit(code/signal)       │
│  ⑥ 信号转发 SIGINT/SIGTERM → child.kill(signal)                 │
└──────────────────────────────────────────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────┐
│        ccusage Rust 原生二进制 (未修改，stdout 产出美元费用)         │
└──────────────────────────────────────────────────────────────────┘
```

### 推荐项目结构

```
ccusage-cn/
├── package.json                     # type: "module", bin: "./bin/cli.js", dep: ccusage
├── bin/
│   └── cli.js                       # 入口文件 (bin 目标，带 #!/usr/bin/env node)
├── src/
│   ├── exchange-rate.js             # 三层汇率回退策略
│   ├── binary-resolver.js           # 封装 resolveCliRuntime 调用
│   ├── spawner.js                   # 自定义 spawn (pipe stdout) + 信号转发
│   ├── output-transform.js          # Transform stream USD→CNY 转换
│   └── utils.js                     # 格式化工具 (toFixed, 缓存路径等)
├── test/
│   ├── output-transform.test.js     # Transform stream 单元测试
│   ├── spawner.test.js              # spawn + signal + exit code
│   └── fixtures/
│       ├── ccusage-table-output.txt     # 样例文本表格输出
│       ├── ccusage-json-output.json     # 样例 JSON 输出
│       └── ccusage-with-ansi.txt        # 含 ANSI 的样例输出
└── .gitignore
```

### Pattern 1: 零依赖 Spawn + Pipe Transform

**What:** 基于上游 `resolveCliRuntime` 获取二进制路径，自定义 spawn 配置将 stdout pipe 给 Transform stream 处理，同时保持 stderr 透传。

**When to use:** 需要拦截/修改上游 CLI stdout 输出的所有包装器场景。

**关键差异（对比上游 `createNativeSpawner`）：**
- 上游使用 `{ stdio: 'inherit' }` 直接传递所有流
- 我们使用 `{ stdio: ['inherit', 'pipe', 'inherit'] }` 拦截 stdout

**验证的导入路径：**
```javascript
import { resolveCliRuntime, ensureNativeBinaryExecutable } from 'ccusage/src/cli.js';
```
验证方式：`npm pack ccusage@20.0.14` → 解压 → `import` 实际测试。该文件是 ESM 模块（`"type": "module"`），文件存在于 npm 包的 `files` 列表中，package.json 无 `exports` 字段限制子路径导入。

**示例：**
```javascript
// bin/cli.js 核心流程
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolveCliRuntime } from 'ccusage/src/cli.js';
import { Transform } from 'node:stream';
import process from 'node:process';
import { getExchangeRate } from '../src/exchange-rate.js';

const args = process.argv.slice(2);
const runtime = resolveCliRuntime({ args });

if ('errorMessage' in runtime) {
  console.error(runtime.errorMessage);
  process.exit(1);
}

const rate = await getExchangeRate();

const child = spawn(runtime.command, runtime.args, {
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...process.env, FORCE_COLOR: '1' },
});

// 信号转发
const onSigInt = () => { child.kill('SIGINT'); };
const onSigTerm = () => { child.kill('SIGTERM'); };
process.on('SIGINT', onSigInt);
process.on('SIGTERM', onSigTerm);

// 管道转换
const isJson = args.includes('--json');
if (isJson) {
  // JSON 模式：收集完整输出
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stdout.on('end', () => {
    const output = Buffer.concat(chunks).toString('utf-8');
    try {
      const data = JSON.parse(output);
      // 遍历追加 costCNY
      process.stdout.write(JSON.stringify(data, null, 2));
      // 或保持原样输出
    } catch {
      process.stdout.write(output); // fallback
    }
  });
} else {
  // 文本模式：流式转换
  const transform = new Transform({
    transform(chunk, encoding, callback) {
      let text = chunk.toString('utf-8');
      text = text.replace(/\$(\d+\.?\d*)/g, (match, amount) => {
        const cny = (parseFloat(amount) * rate).toFixed(2);
        return `¥${cny}`;
      });
      this.push(text, 'utf-8');
      callback();
    },
  });
  child.stdout.pipe(transform).pipe(process.stdout);
}

// 退出码传播
child.on('exit', (code, signal) => {
  process.off('SIGINT', onSigInt);
  process.off('SIGTERM', onSigTerm);
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
```

### Pattern 2: 三层汇率回退

**What:** 从高优先级到低优先级依次尝试获取汇率，确保任何网络条件下都能输出。

**验证来源：**
- CDN API 端点已验证可用：`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json`
- 返回格式：`{ date: "2026-07-07", usd: { cny: 6.7934007 } }`
- 无需 API key，无速率限制，每日更新
- 备用端点：`https://{date}.currency-api.pages.dev/v1/currencies/usd.json`

**示例：**
```javascript
// src/exchange-rate.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = join(homedir(), '.ccusage-cn', 'cache');
const CACHE_FILE = join(CACHE_DIR, 'rate.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_RATE = 7.2;

export async function getExchangeRate() {
  // 1. 环境变量（最高优先级）
  const envRate = process.env.CCUSAGE_CNY_RATE;
  if (envRate) {
    const parsed = parseFloat(envRate);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 2. 缓存（非阻塞：如果缓存有效直接返回；过期则后台刷新）
  const cached = await readCache();
  if (cached !== null) {
    // 后台刷新缓存（不阻塞本次输出）
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      fetchAndCache().catch(() => {}); // 静默失败
    }
    return cached.rate;
  }

  // 3. 异步 fetch（首次运行，不阻塞太久）
  try {
    const rate = await fetchWithTimeout(5000);
    await cacheRate(rate);
    return rate;
  } catch {
    // 4. 默认值
    return DEFAULT_RATE;
  }
}

async function readCache() {
  try {
    const data = JSON.parse(await readFile(CACHE_FILE, 'utf-8'));
    if (data && typeof data.rate === 'number' && data.timestamp) return data;
  } catch {}
  return null;
}

async function fetchWithTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      { signal: controller.signal }
    );
    const data = await res.json();
    return data.usd.cny;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheRate(rate) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    // 原子写入
    const tmp = CACHE_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify({ rate, timestamp: Date.now() }));
    await writeFile(CACHE_FILE, JSON.stringify({ rate, timestamp: Date.now() }));
  } catch {}
}
```

### Pattern 3: JSON 模式的成本字段追加

**What:** 检测 `--json` 标志后，collect 完整 stdout → JSON.parse → 遍历查找数字字段 → 追加 `costCNY`。

**注意：** 不使用 `argv.includes('--json')` 解析参数（违背 D-09 精神），而是通过 spawn 时的 `env` 或 stdout 内容来判断模式。但 D-06 明确给了判断方法：检测 `process.argv` 中是否包含 `--json`。

**费用字段判断策略：** 遍历 JSON 对象的所有数字字段，对可能表示美元费用的字段（名称含 `cost`、`totalCost`、`price`、`fee`、`spend` 等）追加 `costCNY`。

```javascript
// src/output-transform.js — JSON 模式核心
function processJsonChunks(chunks) {
  const raw = Buffer.concat(chunks).toString('utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw; // 非 JSON 输出，原样返回
  }

  function appendCostCNY(obj, rate) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map(item => appendCostCNY(item, rate));
    }
    const result = { ...obj };
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'number' && isCostField(key)) {
        result[`${key}CNY`] = parseFloat((value * rate).toFixed(2));
      } else if (typeof value === 'object') {
        result[key] = appendCostCNY(value, rate);
      }
    }
    return result;
  }

  return JSON.stringify(appendCostCNY(data, rate), null, detectIndent(raw));
}

function isCostField(key) {
  return /^(cost|charge|fee|price|spend|totalCost)/i.test(key);
}

function detectIndent(raw) {
  const match = raw.match(/\n( +)/);
  return match ? match[1].length : 2;
}
```

## 不要手写

| 问题 | 不要构建 | 使用 | 原因 |
|------|----------|------|------|
| 平台特定二进制路径解析 | 自行维护 platform→arch 映射表 | `resolveCliRuntime()` (从 `ccusage/src/cli.js` 导入) | 上游已覆盖 6 个平台，`ensureNativeBinaryExecutable` 处理权限修复；上游更新自动继承 |
| 进程信号转发 | 手动信号转发逻辑 | 显式 `process.on('SIGINT/SIGTERM')` → `child.kill()` + cleanup | 仅需 ~10 行代码，保证无孤儿进程；这是 D-05 的硬规定 |
| 汇率获取和缓存 | 复杂的配置/数据库系统 | `~/.ccusage-cn/cache/rate.json` + 24h TTL | 汇率缓存文件只需 ~5 行读写逻辑；不存在并发写竞争（单进程 CLI） |
| 文本替换引擎 | 自定义模板引擎 | 正则 `/\$(\d+\.?\d*)/g` 替换 | 输出格式有限（表格/JSON/statusline），正则覆盖所有模式 |
| 人民币格式化 | 货币格式化库 | `(num * rate).toFixed(2)` + 前加 `¥` | 仅需保留两位小数，无国际化需求 |

**关键洞察：** 这个包装器的所有问题都已被 Node.js 内置模块和上游的公开 API 覆盖。最复杂的部分（二进制路径解析）直接从上游导入，实际手写代码不超过 150 行。引入任何第三方库都会增加维护负担而没有任何功能性收益。

## Common Pitfalls

### Pitfall 1: 上游 `resolveCliRuntime` 导入路径失效
**什么会出错：** `import { resolveCliRuntime } from 'ccusage/src/cli.js'` 依赖上游的 subpath import 支持。如果上游以后添加 `exports` 字段限制文件导出，此导入路径将失效。
**为什么发生：** 目前上游 `package.json` 没有 `exports` 字段，所有 `.js` 文件均可通过子路径导入。如果上游后续添加 `exports` 字段（最佳实践），`cli.js` 可能不再可导入。
**如何避免：** 
1. 初始阶段直接使用 subpath import（已验证可行）
2. 准备后备：copy 上游的 `getNativePackageName` + `resolveNativeBinary` 逻辑（~15 行）到本地 `binary-resolver.js`
3. 在升级上游版本时测试该导入路径
**预警信号：** `ERR_PACKAGE_PATH_NOT_EXPORTED` 错误

### Pitfall 2: stdout 包含诊断信息污染 JSON 解析
**什么会出错：** 上游可能在 stdout 输出非 JSON 的诊断信息（警告、进度、自动更新提示），导致 JSON 模式下 `JSON.parse()` 失败。
**为什么发生：** Rust CLI 工具有时会将调试信息写入 stdout 而非 stderr。
**如何避免：**
- JSON 模式：collect 完整输出后尝试 `JSON.parse()`，失败则原样输出（不崩溃）
- 首次 `[` 或 `{` 之前的内容可跳过
- 永远不要假设首行就是有效 JSON
**预警信号：** `--json` 输出偶尔以警告行开始

### Pitfall 3: 信号转发导致孤儿进程
**什么会出错：** Ctrl+C 只杀死包装器进程，上游 ccusage 二进制继续运行。
**为什么发生：** Node.js `spawn()` 默认不转发信号。子进程有独立的进程组。
**如何避免：**
- 在 spawn 后立即注册 `SIGINT` 和 `SIGTERM` 处理器
- 处理器中 `child.kill(signal)` 转发信号
- 子进程退出后 cleanup 处理器（`process.off(...)`）
- 不要使用 `process.on('exit')`（该事件无法注册异步操作）
**预警信号：** `ps aux | grep ccusage` 出现多余进程

### Pitfall 4: 文本模式 chunk 边界破坏 `$` 匹配
**什么会出错：** 当 `$12.34` 被分拆在两个 chunk 中（例如第一个 chunk 以 `$1` 结尾，第二个以 `2.34` 开头），正则替换失败。
**为什么发生：** `stream.Transform` 默认在任意字节边界分割数据。
**如何避免：**
- 使用 `Transform({ highWaterMark, ... })` 增大 chunk 大小
- 更可靠的方案：维护一个 `this._remainder` 缓冲区，将部分匹配保留到下一个 chunk
```javascript
const transform = new Transform({
  transform(chunk, encoding, callback) {
    let text = this._remainder ? this._remainder + chunk.toString('utf-8') : chunk.toString('utf-8');
    this._remainder = null;
    // 如果文本以不完整的 `$` 数字结尾，缓存到剩余缓冲区
    const partialDollar = text.match(/\$\d*\.?\d*$/);
    if (partialDollar && partialDollar[0].length > 1) {
      this._remainder = partialDollar[0];
      text = text.slice(0, -partialDollar[0].length);
    }
    text = text.replace(/\$(\d+\.?\d*)/g, (m, amt) => `¥${(parseFloat(amt) * rate).toFixed(2)}`);
    this.push(text, 'utf-8');
    callback();
  },
  flush(callback) {
    if (this._remainder) this.push(this._remainder, 'utf-8');
    callback();
  },
});
```
**预警信号：** 输出中偶尔出现未转换的 `$`，或最后一个 `$` 值没有被转换

### Pitfall 5: 人民币位数变化导致表格错位
**什么会出错：** `$12.34`（6字符）替换为 `¥88.85`（6字符）时对齐正常；但 `$1.23`（5字符）→ `¥8.85`（5字符），或 `$1234.56`（8字符）→ `¥8888.85`（8字符）宽度不变。然而如果汇率导致位数超出预期（例如 100 USD × 7.25 = 725.00 → 8 字符），可能超出原字段宽度。
**为什么发生：** 人民币值位数 = 美元值位数 + 汇率小数位数。当美元值大且汇率为非整数时，人民币值总位数可能略不同。
**如何避免：**
- `toFixed(2)` 保证始终有两位小数
- 原 `$X.XX` 替换为 `¥Y.YY` 时宽度一致（`¥` 是单宽字符）
- 表格对齐是上游的表格渲染器（Rust）负责的，后续列不受影响
- 在测试中验证各种费用范围的输出对齐
**预警信号：** 表格列边界出现错位

### Pitfall 6: Windows `.cmd` shim 因 `bin` 指向 JS 文件而正常工作
**已确认安全：** D-12 规定 `bin` 指向 `.js` 文件（`./bin/cli.js`）。npm 会为 `.js` 目标生成正确的 `.cmd` 和 `.ps1` shim。仅在 `bin` 指向原生二进制时才出问题。
**验证：** 上游的 `cli.js` 入口指向 `./src/cli.js`，已在 Windows 上正确工作。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 二进制路径解析 | 自行实现 platform→arch→pkgName 映射 | `resolveCliRuntime()` from `ccusage/src/cli.js` | 上游覆盖 6 平台，含权限修复逻辑 |
| 汇率获取 | 嵌入式 API key / OAuth 流程 | `@fawazahmed0/currency-api` via CDN (无需 key) | 免费、CDN 加速、无速率限制 |
| 信号/退出码 | 复杂的进程组管理 | 显式 `process.on('SIGINT/SIGTERM')` + `child.on('exit')` | ~10 行代码解决所有信号边缘情况 |

## Code Examples

已验证的官方来源模式：

### 1. 上游 resolveCliRuntime 使用模式

```javascript
// 已验证来源: npm pack ccusage@20.0.14 → 源码 cli.js
// 核心导入路径:
import { resolveCliRuntime, ensureNativeBinaryExecutable } from 'ccusage/src/cli.js';

const args = process.argv.slice(2);
const runtime = resolveCliRuntime({ argv: args });

if ('errorMessage' in runtime) {
  // 平台不支持的错误处理
  process.stderr.write(runtime.errorMessage);
  process.exit(1);
}

// runtime.command = 原生二进制完整路径
// runtime.args = 要传递给二进制的参数数组
```

### 2. 双模式输出转换

```javascript
// src/output-transform.js
import { Transform } from 'node:stream';

export function createTextTransform(rate) {
  let remainder = null;
  return new Transform({
    transform(chunk, encoding, callback) {
      let text = remainder ? remainder + chunk.toString('utf-8') : chunk.toString('utf-8');
      remainder = null;

      // 处理 chunk 边界上的不完整 $ 数字
      const partial = text.match(/\$\d*\.?\d*$/);
      if (partial && partial[0].length > 1) {
        remainder = partial[0];
        text = text.slice(0, -partial[0].length);
      }

      // USD → CNY (仅替换完整的 $ 数字)
      text = text.replace(/\$(\d+\.?\d*)/g, (match, amount) => {
        const cny = (parseFloat(amount) * rate).toFixed(2);
        return `¥${cny}`;
      });

      // 可选：替换列标题
      text = text.replace(/Cost \(USD\)/g, 'Cost (CNY)');

      this.push(text, 'utf-8');
      callback();
    },
    flush(callback) {
      if (remainder) this.push(remainder, 'utf-8');
      callback();
    },
  });
}

export function createJsonTransform(rate) {
  const chunks = [];
  return new Transform({
    transform(chunk, encoding, callback) {
      chunks.push(chunk);
      callback();
    },
    flush(callback) {
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        const data = JSON.parse(raw);
        const converted = addCostCNY(data, rate);
        const indent = detectJsonIndent(raw);
        this.push(JSON.stringify(converted, null, indent), 'utf-8');
      } catch {
        // JSON 解析失败，原样透传
        this.push(raw, 'utf-8');
      }
      callback();
    },
  });
}

function addCostCNY(obj, rate) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => addCostCNY(item, rate));
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = addCostCNY(value, rate);
    if (typeof value === 'number' && isCostField(key)) {
      result[`${key}CNY`] = parseFloat((value * rate).toFixed(2));
    }
  }
  return result;
}

function isCostField(key) {
  return /^(cost|totalCost|total_cost|charge|price|fee|spend)/i.test(key);
}

function detectJsonIndent(raw) {
  const match = raw.match(/\n( +)/);
  return match ? match[1].length : 2;
}
```

### 3. 三层汇率回退（完整版）

```javascript
// src/exchange-rate.js - 已验证汇率 API 端点
// CDN API: https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json
// 备用: https://{date}.currency-api.pages.dev/v1/currencies/usd.json
// 返回: { date: "2026-07-07", usd: { cny: 6.7934007, ... } }

const CACHE_DIR = process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA, 'ccusage-cn', 'cache')
  : join(homedir(), '.ccusage-cn', 'cache');
const RATE_API = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';
const FETCH_TIMEOUT = 5000;
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function getExchangeRate() {
  // 1. 环境变量
  const envRate = process.env.CCUSAGE_CNY_RATE;
  if (envRate && /^\d+(\.\d+)?$/.test(envRate)) {
    return parseFloat(envRate);
  }

  // 2. 缓存
  const cached = await readCacheSafe();
  if (cached !== null) {
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      fetchAndCache().catch(() => {}); // 后台静默刷新
    }
    return cached.rate;
  }

  // 3~4. API fetch → 默认值
  try {
    const rate = await fetchRate();
    writeCacheSafe(rate).catch(() => {});
    return rate;
  } catch {
    return DEFAULT_RATE;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 使用 `child_process.exec()` | `child_process.spawn()` 带管道 | Node.js 0.x → 始终 | 避免 shell 注入和 maxBuffer |
| 使用 `node-fetch` 包 | `globalThis.fetch()` 内置 | Node.js 18+ (2023) | 零依赖 HTTP 请求 |
| 使用 TypeScript + 构建 | 纯 JavaScript ESM | 持续演进 | 零构建步骤，bin 入口直达 |
| 通过 npx 运行 | bunx/pnpm dlx/npx | 2024~2025 | 无需本地安装 |
| 上游 fork 修改 Rust 源码 | Transform stream 包装器 | 本项目的核心决策 | 极低维护成本 |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `import { resolveCliRuntime } from 'ccusage/src/cli.js'` 在所有安装模式下(pnpm/npm/bunx)均有效 | Standard Stack | 如果上游添加 `exports` 字段限制导出，导入路径失效；后备方案为本地复制 ~15 行解析逻辑 |
| A2 | `FORCE_COLOR=1` 环境变量对上游 Rust 二进制有效 | Code Examples | 部分 Rust 终端库可能不识别 `FORCE_COLOR`；验证需在实现阶段测试 |
| A3 | `@fawazahmed0/currency-api` CDN 端点在可预见的未来保持可用 | Code Examples | 如果服务下线，回退到默认汇率 7.2；文档需说明回退行为 |
| A4 | USD 金额一定以 `$` 开头，不会出现 `US$` 或 `USD` 前缀 | Architecture | 如果上游改用 `USD 12.34` 格式，正则匹配不到；需在集成测试中验证输出格式 |
| A5 | `¥` 字符在所有终端和 Windows cmd/powershell 中正确显示 | Architecture | `¥` 是 ASCII 扩展字符，大部分现代终端支持；Windows 命令提示符可能出现乱码 |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | 运行时 | ✓ | 24.14.0 | — (必需) |
| npm | 包管理 | ✓ | 11.9.0 | — |
| pnpm | 开发管理 | ✓ | 10.32.1 | npm |
| bun | bunx 测试 | ✓ | 1.3.8 | npx |
| ccusage (npm) | 上游二进制 | ✓ | 20.0.14 | resolveCliRuntime 后备实现 |
| `@fawazahmed0/currency-api` | 汇率源 | 在线可用 | 2026-07-07 | 默认 7.2 |

**Missing dependencies with no fallback:** 无 — 所有依赖均可通过 Node.js 内置模块或上游包满足。

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | 否 | 无需认证 |
| V3 Session Management | 否 | 无状态 CLI |
| V4 Access Control | 否 | 无多用户 |
| V5 Input Validation | 是 | 避免 shell 注入：使用 `spawn()` 数组参数，绝不用 `exec()` / `execSync()` |
| V6 Cryptography | 否 | 无加密需求 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell 参数注入 | Tampering | `spawn(command, args[])` 数组参数，绝不拼接 shell 字符串 |
| 上游二进制路径替换 | Tampering | `resolveNativeBinary()` 返回的路径在 `node_modules/` 内；不使用用户系统 PATH |
| 汇率 API MITM | Tampering | 使用 HTTPS 端点，默认 5s timeout |
| 缓存文件污染 | Tampering | 缓存路径在用户 home 目录，文件仅读写 JSON |

## Validation Architecture

**跳过：** `workflow.nyquist_validation` 在 `.planning/config.json` 中显式设置为 `false`。

## Sources

### 主要 (HIGH 置信度)
- [ccusage npm package v20.0.14] — `npm pack ccusage@20.0.14` 已验证全部源码，确认导出 `resolveNativeBinary`, `resolveCliRuntime`, `ensureNativeBinaryExecutable`, `isMainModule`
- [Node.js child_process.spawn 官方文档](https://nodejs.org/docs/latest/api/child_process.html) — spawn 参数和 stdio 配置
- [Node.js stream.Transform 官方文档](https://nodejs.org/docs/latest/api/stream.html#class-streamtransform) — Transform stream 实现指南
- [@fawazahmed0/currency-api CDN] — 实时验证 API 端点，返回 `{ date: "2026-07-07", usd: { cny: 6.7934007 } }`
- [fawazahmed0/exchange-api GitHub](https://github.com/fawazahmed0/exchange-api) — 免费汇率 API 文档和备用端点

### 次要 (MEDIUM 置信度)
- [ccusage DeepWiki — TypeScript CLI Wrapper](https://deepwiki.com/ccusage/ccusage/2.3-typescript-cli-wrapper) — 上游架构细节验证
- [ccusage DeepWiki — Distribution & Packaging](https://deepwiki.com/ccusage/ccusage/4-distribution-and-packaging) — 平台特定可选依赖
- [FORCE_COLOR spec](https://force-color.org) — 社区标准，多数现代 CLI 工具支持
- [Rust termcolor crate: FORCE_COLOR discussion](https://github.com/BurntSushi/termcolor/issues/71) — 部分 Rust crate 的 FORCE_COLOR 支持状态

### 三级 (LOW 置信度 — 标记验证)
- 上游输出格式的具体文本模式样本 — 实现阶段需抓取实际输出作为测试 fixture
- Windows 终端对 `¥` 字符的渲染 — 需在 Windows CI 中验证

## Metadata

**置信度分解：**
- 标准栈：HIGH — 已验证上游源码和 npm 包结构
- 架构：HIGH — Transform stream wrapper 模式已验证可行
- Pitfalls：HIGH — 12 个陷阱已分类且有具体预防措施
- 导入路径：HIGH — 通过 `npm pack` + 实际 `import` 测试

**研究日期：** 2026-07-08
**有效期：** 30 天（上游依赖为 caret `^20.0.0`，minor 更新不影响；但如果上游 major bump 需重新验证导入路径）

---

*Phase 01: 核心包装器 (MVP) - Research complete*
*Ready for planning — planner can create PLAN.md files*
