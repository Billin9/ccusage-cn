# Stack Research

**Domain:** npm CLI wrapper — USD-to-RMB adapter for upstream Rust-based CLI tool
**Researched:** 2026-07-08
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | >= 18 (LTS) | Runtime for the wrapper script | Upstream (`ccusage`) already ships a Node.js CLI wrapper as its npm entry point. Node 18+ has built-in `fetch()` for exchange rate API calls, `node:child_process` for spawning, and full ESM support. No additional runtime required. |
| npm (package format) | — | Distribution medium | `bunx`, `npx`, and `pnpm dlx` all consume npm packages. `ccusage-cn` must be a standard npm package with a `bin` entry. The upstream is also npm-distributed. |
| JavaScript (ESM) | ES2022 | Wrapper language | No build step needed. TypeScript requires a compilation step for the `bin` script (or `tsx` as a runtime dependency), adding complexity without benefit — the wrapper is ~50 lines. Use JSDoc annotations for type safety as the upstream does. |
| pnpm | >= 9 | Local development package manager | Matches upstream's monorepo setup. Ensures deterministic lockfile via `pnpm-lock.yaml`. Avoids dependency hoisting issues that npm has. Not required for end users — only for development. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | This wrapper needs **zero external runtime dependencies** beyond the upstream `ccusage` package. Node.js built-ins (`node:child_process`, `node:stream`, `node:process`, `node:module`) cover all requirements. The upstream provides all native binary resolution logic. |
| vitest | ^3.0 | Testing framework | ESM-native, fast, file-watching for development. Use for integration tests that verify output transformation works correctly on representative ccusage output samples. |
| ava | Any | Alternative test runner | If you prefer a more minimal test runner. Vitest is preferred for its faster iteration and Jest-compatible API. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` (optional) | Type-checking JSDoc annotations | `npx tsc --noEmit` for type-checking without compilation. Not required for running the wrapper. |
| `publint` | Validate npm package quality | Upstream already uses this. Run before `npm publish` to catch packaging issues. |
| `bun` (optional) | Testing the `bunx` workflow | Useful for manually verifying `bunx ccusage-cn` works end-to-end during development. |

## Installation

```bash
# Development
pnpm add -D vitest

# Runtime dependency (upstream)
pnpm add ccusage@^20.0.0

# No other runtime dependencies needed
```

```bash
# End user install (they never run this — they use bunx/npx)
bunx ccusage-cn daily
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Node.js wrapper (current) | Shell script wrapper (bare `#!` sh script) | Only if you don't need reliable output transformation. A shell pipe (`ccusage | sed`) cannot detect `--json` mode, cannot handle streaming edge cases (partial `$` in chunk), and has poor Windows support. |
| Node.js wrapper (current) | Fork upstream + modify Rust source | If upstream license forced AGPL or prohibited wrapper/distributions. MIT license permits both. Forking creates 90%+ maintenance burden (merge conflicts, CI duplication, release management). Only fork if you need to modify the Rust core (out of scope). |
| Node.js wrapper (current) | Using `bin-shim` npm package | `bin-shim` (v0.1.3, May 2026) abstracts binary resolution logic. But we don't need it — the upstream already exports `resolveCliRuntime` and `resolveNativeBinary`. Adding `bin-shim` is an unnecessary dependency that doesn't handle output transformation (our core need). |
| Node.js wrapper (current) | Deno / Bun as runtime | The upstream's ESM module is designed for Node.js. Using Deno or Bun would require Node-compat mode. Since the primary use case is `bunx ccusage-cn` (Bun runs the script with Node.js compat anyway), stick with Node.js runtime compatibility. |
| Plain JS (recommended) | TypeScript | If the wrapper grows beyond ~150 lines, TypeScript adds marginal value. For a simple ~50-line spawn+transform wrapper, the build step overhead (compile, publish compiled JS) isn't justified. Upstream also uses plain JS with JSDoc. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| TypeScript for the bin script | Requires a build step to publish. The wrapper is <100 lines. Adding `tsc`, `outDir` config, and source maps quadruples the complexity for zero runtime benefit. | Plain JavaScript ESM with JSDoc type annotations (exactly what upstream does). |
| `child_process.execSync` or `child_process.exec` | Both buffer entire output in memory with limited size (`maxBuffer: 1024 * 1024` by default). Risky for unknown output size. | `child_process.spawn()` with streaming output. Use `stdio` piping for stdout, stream transformation for USD->CNY. |
| Bundlers (esbuild, rollup, webpack) | No reason to bundle a 50-line script that runs on Node.js. Bundling introduces sourcemap, compat, and debugging complexity. | Ship the source `.js` file directly. The npm package's `"type": "module"` ensures ESM. |
| Static hardcoded exchange rate | CNY->USD rate fluctuates. A hardcoded rate will be wrong within weeks, and the project will seem abandoned even if the wrapper itself is fine. | Env var `CCUSAGE_CNY_RATE` for manual override, with free API fallback (no API key needed), plus a temp-file cache. |
| Full `node-fetch` or `axios` for API calls | Built-in `fetch()` has been stable since Node.js 18. No need for third-party HTTP libraries. | `globalThis.fetch` (native). |
| Any currency conversion npm package (e.g., `money`, `fx`) | Overkill for a single conversion pair (USD->CNY). A `* rate` multiplication with `toFixed(2)` is all that's needed. | `(usdAmount * exchangeRate).toFixed(2)` — two lines of code. |

## Stack Patterns by Variant

**If the wrapper grows to support multiple currencies in the future:**
- Add a `--currency` flag and a mapping of currency codes to exchange rate sources
- Still do not introduce a currency library — it remains a simple multiplication
- The architecture (spawn + stream-transform) remains identical, just the regex/transform logic scales

**If upstream changes its cli.js exports or internal structure:**
- Pin the `ccusage` dependency more tightly (e.g., `>=20.0.0 <21.0.0`)
- If `resolveCliRuntime` is removed, fall back to our own copy of the platform detection logic (~15 lines, trivially reimplementable)
- A GitHub Actions weekly CI test against latest upstream catches breakage before users report it

## Architecture of How It Works

```
bunx ccusage-cn daily --breakdown
  │
  ▼
ccusage-cn/src/cli.js (our entry point, "bin": { "ccusage-cn": ... })
  │
  ├─ import { resolveCliRuntime } from 'ccusage/src/cli.js'
  │     └─ resolves @ccusage/ccusage-darwin-arm64/bin/ccusage
  │
  ├─ spawn(nativeBinary, argv, { stdio: ['inherit', 'pipe', 'inherit'] })
  │     └─ stdout piped to transform stream
  │
  ├─ TransformStream:  $X.XX → ¥X.XX   (and Cost (USD) → Cost (CNY))
  │     └─ exchange rate from: env var > API cache > fallback
  │
  └─ pipe transformed stdout to process.stdout
       propagate exit code
```

Dependency chain for end users:
```
bunx ccusage-cn
  └─ ccusage-cn@x.y.z  (npm package)
       └─ dependency: ccusage@^20.0.0
            ├─ optional: @ccusage/ccusage-darwin-arm64 (on macOS ARM)
            ├─ optional: @ccusage/ccusage-darwin-x64    (on macOS Intel)
            ├─ optional: @ccusage/ccusage-linux-arm64   (on Linux ARM)
            ├─ optional: @ccusage/ccusage-linux-x64     (on Linux x64)
            ├─ optional: @ccusage/ccusage-win32-arm64   (on Windows ARM)
            └─ optional: @ccusage/ccusage-win32-x64     (on Windows x64)
```

Users install nothing. `bunx ccusage-cn` fetches all transitive dependencies automatically.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `ccusage@^20.0.0` | Node.js >= 18 | Upstream targets Node 16+, but we need Node 18+ for native `fetch()`. Users running via `bunx` use Bun's polyfilled fetch regardless. |
| `@ccusage/ccusage-darwin-arm64@20.x` | macOS >= 11 (ARM) | Platform optional dependency. `bunx`/`npx` automatically installs the correct optional dep for the current platform. Other platform optional deps are skipped. |
| all `@ccusage/ccusage-*` | Must match same version | Upstream publishes all platform packages matched to the same version number. Our `ccusage` dependency version range (`^20.0.0`) ensures the correct platform package is chosen. |

## Exchange Rate Strategy

No additional npm package needed. Three-tier fallback:

1. **`CCUSAGE_CNY_RATE` env var** — highest priority, user-set
2. **Cached API fetch** — fetches from `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json` (no API key needed, free, fast CDN), caches to `os.tmpdir()` for 1 hour
3. **Hardcoded fallback** — `7.2` (a reasonable approximate, labeled in code as fallback)

Rationale for CDN choice over other APIs:
- No API key required
- No rate limiting for our use pattern (single request per hour per user)
- Static JSON file served from CDN edge (fast)
- Reliable (hosted on jsDelivr, backed by npm)

## Sources

- **npm registry metadata for `ccusage` v20.0.14** — Verified package structure: 5 files, bin → `./src/cli.js`, optional deps for 6 platforms. npm view command output.
- **Upstream cli.js source** — Verified exports: `resolveCliRuntime`, `resolveNativeBinary`, `ensureNativeBinaryExecutable`. ESM module pattern with `createRequire`. Platform detection via `process.platform + process.arch`. [HIGH confidence]
- **DeepWiki ccusage daily reports** — Verified output format: tabular with "Cost (USD)" column header, `$X.XX` format. [MEDIUM confidence — verified via web search, not official docs]
- **Socket.dev npm bin-shim analysis** — Confirmed the canonical wrapper pattern (optionalDependencies + spawn) and its limitations for output interception. [HIGH confidence]
- **jsDelivr / @fawazahmed0/currency-api** — Widely used, free, no-API-key currency conversion source. Used in production by multiple open-source projects. [MEDIUM confidence]

**Confidence assessment:**
- Runtime choice (Node.js): HIGH — upstream is Node.js-native, no alternative makes sense
- Library zero-dependency stance: HIGH — built-in Node.js APIs cover all needs
- Output transformation approach: MEDIUM — regex on stdout works for table output; JSON mode needs special handling not yet validated against all upstream output formats
- Exchange rate strategy: MEDIUM — CDN API is reliable but incurs a 1-3s latency on first run after cache expiry

---

*Stack research for: ccusage-cn (USD-to-RMB CLI wrapper)*
*Researched: 2026-07-08*
