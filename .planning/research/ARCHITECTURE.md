# Architecture Research

**Domain:** CLI wrapper / adapter for npm-distributed Rust binary localization
**Researched:** 2026-07-08
**Confidence:** HIGH (verified against upstream ccusage source, Node.js spawn patterns, Rust color-detection ecosystem, npm packaging conventions)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        User Terminal                                 │
│  bunx ccusage-cn -b  /  bunx ccusage-cn --monthly --json            │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     ccusage-cn CLI  (cli.js)                         │
│                                                                      │
│  ┌─────────────────────┐   ┌──────────────────────────────────────┐ │
│  │  Binary Resolver     │   │  Argument Forwarder                  │ │
│  │  • require.resolve   │──▶│  • process.argv.slice(2) → binary   │ │
│  │    ccusage/package   │   │  • 100% transparent pass-through    │ │
│  │  • platform mapping  │   └──────────────┬───────────────────────┘ │
│  │  • permission repair │                  │                         │
│  └──────────────────────┘                  ▼                         │
│                                  ┌──────────────────────────────┐   │
│                                  │  Binary Spawner              │   │
│                                  │  • spawn(binary, args, {     │   │
│                                  │      env: {FORCE_COLOR: "1"},│   │
│                                  │      stdio: ['inherit',      │   │
│                                  │              'pipe',         │   │
│                                  │              'inherit']      │   │
│                                  │    })                         │   │
│                                  │  • signal forwarding          │   │
│                                  │    (SIGINT/SIGTERM passthru) │   │
│                                  │  • exit code propagation      │   │
│                                  └──────────────┬────────────────┘   │
│                                                 │                    │
│          ┌──────────────────────────────────────┘                    │
│          │                                      ┌──────────────────┐ │
│          ▼                      stdout (pipe)   │  stderr (inherit)│ │
│  ┌─────────────────────────┐                    └────────┬─────────┘ │
│  │  Output Transform Stream│                             │           │
│  │  (Node Transform stream)│                             ▼           │
│  │                         │                    ┌──────────────┐    │
│  │  USD→CNY replacements:  │                    │  Error output │    │
│  │  • $X.XX → ¥(X.XX*rate) │                    │  (unchanged)  │    │
│  │  • Cost (USD) → Cost    │                    └──────────────┘    │
│  │    (CNY)                │                                         │
│  │  • JSON totalCost conv  │                                         │
│  │  • Statusline conv      │                                         │
│  │                         │                                         │
│  │  • Alignment-aware sub  │                                         │
│  └───────────┬─────────────┘                                         │
│              │                                                       │
│              ▼                                                       │
│  ┌─────────────────────────┐                                        │
│  │  process.stdout         │                                        │
│  │  (CNY-displayed output) │                                        │
│  └─────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     ccusage Rust Binary (upstream, unmodified)       │
│                                                                      │
│  Reads JSONL logs → calculates token costs → formats output with    │
│  LiteLLM pricing data → writes USD-cost table/JSON/statusline       │
│  to stdout                                                          │
│                                                                      │
│  Installed via npm: ccusage@^VERSION as production dependency        │
│  Auto-updates when ccusage-cn is reinstalled / bumped               │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Binary Resolver** | Locate the platform-specific ccusage native binary from node_modules; repair permissions if needed | `require.resolve('@ccusage/ccusage-darwin-arm64/bin/ccusage')` |
| **Argument Forwarder** | Pass all CLI args unchanged from user to binary | `process.argv.slice(2)` — no parsing or filtering |
| **Binary Spawner** | Spawn the Rust binary with piped stdout, inherited stderr, FORCE_COLOR env; forward signals and exit codes | `child_process.spawn()` with `stdio: ['inherit', 'pipe', 'inherit']` |
| **Output Transform Stream** | Intercept stdout, replace USD cost patterns with CNY equivalents using configurable exchange rate | `stream.Transform` with regex replacement (`/\$(\d[\d,]*\.?\d*)/g`) |
| **Exchange Rate Provider** | Provide USD→CNY exchange rate from configurable source (env var, config file, default) | Read `CCUSAGE_CNY_RATE` env var, fallback to `~/.ccusage-cnrc`, fallback to 7.2 |
| **Upstream ccusage binary** | All core logic: log parsing, token aggregation, cost calculation, terminal rendering | Pre-compiled Rust binary from ccusage npm package |

## Recommended Project Structure

```
ccusage-cn/
├── package.json                    # depends on ccusage as prod dependency
├── tsconfig.json                   # TypeScript config (if using TS)
├── src/
│   ├── cli.ts                      # Entry point (referenced in package.json "bin")
│   ├── binary-resolver.ts          # Locate ccusage native binary from npm deps
│   ├── spawner.ts                  # Spawn binary with stdio config + signal fwd
│   ├── output-transform.ts         # Transform stream: USD→CNY regex replacement
│   ├── exchange-rate.ts            # Rate source: env var -> config -> default
│   └── utils.ts                    # Number formatting, alignment helpers
├── test/
│   ├── output-transform.test.ts    # Transform stream dollar patterns
│   ├── binary-resolver.test.ts     # Binary resolution logic
│   ├── spawner.test.ts             # Spawn + signal + exit code
│   └── fixtures/
│       ├── ccusage-table-output.txt     # Sample ccusage table output
│       ├── ccusage-json-output.json     # Sample JSON output
│       └── ccusage-statusline.txt       # Sample statusline output
├── build.mjs                       # Bundle script (tsdown or esbuild)
└── config-schema.json              # (optional) Schema for future config file
```

### Structure Rationale

- **`cli.ts`:** Single entry point that wires all components together. Registered in `package.json` `"bin"` field as `ccusage-cn`.
- **`binary-resolver.ts`:** Isolated to make the upstream dependency seam explicit. Replaces the upstream's own resolver pattern (platform→package name→binary path) — we re-use their resolution rather than duplicating it.
- **`spawner.ts`:** All process lifecycle management in one place: spawn options, environment variable injection (FORCE_COLOR), signal forwarding (SIGINT/SIGTERM → child), exit code propagation.
- **`output-transform.ts`:** The core localization logic. A `stream.Transform` that processes stdout line-by-line (or chunk-by-chunk) applying USD→CNY replacements. Separating this makes testing easy — feed in fixture output, assert transformed output.
- **`exchange-rate.ts`:** Rate sourcing strategy pattern. Single function `getExchangeRate(): Promise<number>` with layered fallback. Isolated so swapping from env-var to live API later doesn't touch other modules.
- **`test/fixtures/`:** Captured real ccusage output across all modes (table, JSON, statusline) for deterministic transform testing.

## Architectural Patterns

### Pattern 1: Transform Stream Wrapper

**What:** Spawn a child process with piped stdout, pipe through a `stream.Transform` that modifies output, then pipe to `process.stdout`.

**When to use:** Wrapping an existing CLI with output transformation that does not require modifying the underlying binary.

**Trade-offs:**
- **Pro:** Zero modifications to upstream — auto-update via npm dependency resolution
- **Pro:** Only ~150 lines of active code needed for the transform logic
- **Pro:** No Rust toolchain required for development
- **Con:** Piped stdout disables TTY detection (colors, progress spinners) by default — mitigated by `FORCE_COLOR=1` env var
- **Con:** Regex-based replacement on table output can theoretically produce incorrect matches (``$`` in non-cost contexts)
- **Con:** Column alignment shifts if converted value has different width than original

**Example:**
```typescript
// src/output-transform.ts
import { Transform, TransformCallback } from 'node:stream';

export function createCostTransform(rate: number): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
      let text = chunk.toString('utf-8');

      // Pattern 1: Table/statusline cost values — $X.XX or $ X.XX
      text = text.replace(/\$(\s*)([\d,]+\.?\d*)/g, (_match, space, amount) => {
        const cleanAmount = parseFloat(amount.replace(/,/g, ''));
        if (isNaN(cleanAmount)) return _match; // preserve non-numeric
        const cny = (cleanAmount * rate).toFixed(2);
        return `¥${space}${cny}`;
      });

      // Pattern 2: Column header
      text = text.replace(/Cost \(USD\)/g, 'Cost (CNY)');

      // Pattern 3: JSON output
      text = text.replace(/"totalCost": ([\d.]+)/g, (_, val) => {
        const cny = (parseFloat(val) * rate).toFixed(2);
        return `"totalCost": ${cny}`;
      });

      this.push(text, 'utf-8');
      callback();
    }
  });
}
```

### Pattern 2: Layered Exchange Rate Resolution

**What:** A strategy chain for obtaining the exchange rate — try each source in order, fall through to the next if unavailable.

**When to use:** Any setting that needs env-var override, config file, and sensible default.

**Trade-offs:**
- **Pro:** Zero config for most users (default rate)
- **Pro:** Power users can customize via env var without config files
- **Pro:** Easy to add live API source later without breaking existing code
- **Con:** Adding too many sources creates confusion about precedence; document clearly

**Example:**
```typescript
// src/exchange-rate.ts
export async function getExchangeRate(): Promise<number> {
  // 1. Environment variable (highest priority)
  const envRate = process.env.CCUSAGE_CNY_RATE;
  if (envRate) {
    const parsed = parseFloat(envRate);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // 2. Config file (future)
  // const configRate = await readConfigFile();
  // if (configRate) return configRate;

  // 3. Default (hardcoded, updated periodically via patch releases)
  return 7.2;
}
```

### Pattern 3: Signal-Forwarding Spawner

**What:** Spawn a child process and ensure SIGINT/SIGTERM signals reach both the child and parent correctly.

**When to use:** Any wrapper that spawns a long-running CLI process that needs proper Ctrl+C handling.

**Trade-offs:**
- **Pro:** User feels like they're running the original CLI — no janky signal behavior
- **Pro:** Exit codes propagate correctly for shell scripting
- **Con:** Must handle edge case where child exits before forward signal (double-kill protection)

**Example:**
```typescript
// src/spawner.ts
import { spawn } from 'node:child_process';

export function createSpawner(
  binaryPath: string,
  args: string[],
  extraEnv: Record<string, string>,
): { process: ReturnType<typeof spawn>; promise: Promise<number> } {
  const child = spawn(binaryPath, args, {
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env, ...extraEnv },
  });

  const promise = new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal); // Forward signal to parent
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });

  // Forward parent signals to child (Bun/Node handles SIGINT forwarding
  // to child processes when stdio is inherited, but explicit is safer)
  const onSigInt = () => { child.kill('SIGINT'); };
  const onSigTerm = () => { child.kill('SIGTERM'); };
  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);

  promise.finally(() => {
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
  });

  return { process: child, promise };
}
```

## Data Flow

### Request Flow

```
User runs "bunx ccusage-cn --monthly --json"
    │
    ▼
cli.ts: parse no args (wrapper doesn't parse — all forwarded raw)
    │
    ▼
binary-resolver.ts: require.resolve('ccusage') → discover platform pkg
    │                         ↓
    │         require.resolve('@ccusage/ccusage-darwin-arm64')
    │                         ↓
    │         resolve to: node_modules/@ccusage/ccusage-darwin-arm64/bin/ccusage
    │
    ▼
spawner.ts: spawn(binaryPath, ['--monthly', '--json'], { env: FORCE_COLOR=1 })
    │
    ├── stderr → inherit → user terminal (error messages pass through)
    │
    └── stdout → pipe → output-transform.ts
                            │
                            read chunk from binary
                            │
                            replace $X.XX → ¥(X.XX * rate)
                            replace "Cost (USD)" → "Cost (CNY)"
                            replace JSON totalCost
                            │
                            push transformed chunk → process.stdout
                            │
                            ▼
                        User sees CNY costs in terminal
```

### State Management

This project is **stateless** — every invocation spawns a fresh `ccusage` process. The only persistent state is:

```
[Exchange Rate] ← env var / config file / default
     │
     ▼ (read once at startup)
[ccusage-cn invocation]
     │
     ├── spawn ccusage binary
     ├── transform stdout in-stream
     └── exit (no state saved)
```

No server, no cache, no database. The upstream ccusage handles all data aggregation from JSONL files.

### Key Data Flows

1. **Argument forwarding:** `process.argv.slice(2)` → passed verbatim to binary. No parsing, no filtering, no transformation. This is critical for 100% CLI compatibility.

2. **Cost conversion:** Binary outputs `$X.XX` in stdout stream → Transform stream captures chunks → regex matches cost patterns → multiplies by exchange rate → outputs `¥Y.YY` with same formatting (decimal places, alignment padding).

3. **JSON mode handling:** Binary outputs `"totalCost": 12.34` → Transform detects JSON key → converts value to `(12.34 * rate)` → outputs `"totalCost": 88.85`. The key name stays `totalCost` (consistent schema), value is in CNY.

4. **Error passthrough:** Binary writes errors to stderr → stderr is inherited (not piped) → user sees errors directly, unmodified.

5. **Exit code propagation:** Binary exits with code N → `child.on('exit')` captures it → `process.exit(N)` forwards it to shell.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Current architecture is perfect — zero state, no server, single CLI process |
| 1k-100k users | No changes needed — ccusage-cn is just a thin wrapper; upstream ccusage handles all data |
| 100k+ users | If ccusage-cn needs live exchange rate API: add caching layer (12-hour TTL) to avoid rate limits; add `--offline` mode with cached rate |
| Upstream version bumps | npm `^` semver range handles minor/patch automatically; major version bumps need manual CI check |

### Scaling Priorities

1. **First bottleneck:** None — ccusage-cn adds no computational overhead beyond spawning a process and streaming text through a transform. The bottleneck is upstream ccusage's data parsing speed.

2. **Second bottleneck:** Live exchange rate API (if added later) — use aggressive caching (12-24h TTL) since exchange rates don't change minutely. Fallback to cached/last-known rate if API is unreachable.

## Anti-Patterns

### Anti-Pattern 1: Fork-and-Patch Upstream

**What people do:** Fork the ccusage repo, modify `output.rs` to hardcode CNY, publish as separate Rust binary, then try to rebase upstream changes.

**Why it's wrong:** Every upstream release requires manual merge conflict resolution. Rust output formatting code changes frequently (table layout, formatting options). The maintenance burden quickly exceeds the initial "savings" of a simpler implementation. Incompatible with the project's core value of "near-zero maintenance."

**Do this instead:** Use the Transform stream wrapper pattern. Upstream changes flow through automatically via npm dependency resolution. The wrapper code (~150 lines) is independent of upstream internals.

### Anti-Pattern 2: Parsing CLI Arguments in the Wrapper

**What people do:** The wrapper parses `process.argv` to "understand" what output format the user requested, then applies different transformations per mode.

**Why it's wrong:** Adds coupling to upstream's CLI interface. If upstream adds a new argument, changes argument names, or alters behavior, the wrapper breaks. It also duplicates argument parsing logic that already exists in the Rust binary.

**Do this instead:** Forward all arguments verbatim to the binary. Apply universal regex transformations that work across output formats. Don't try to understand what the binary will do — just transform its output consistently.

### Anti-Pattern 3: Blocking on Full Output Before Transforming

**What people do:** Collect all stdout into a string, then apply transformations, then write to stdout.

**Why it's wrong:** Breaks streaming output — user doesn't see anything until the binary completes. For long-running commands or large datasets, this creates a poor UX. Also risks memory exhaustion with very large outputs.

**Do this instead:** Use streaming `Transform` that processes chunks as they arrive. The transform should be stateless (or minimally stateful — e.g., handling partial matches at chunk boundaries). User sees output in real-time as ccusage produces it.

### Anti-Pattern 4: Using node-pty Prematurely

**What people do:** Add `node-pty` as a dependency from day one to solve the TTY/color problem, adding native compilation complexity (node-gyp) before verifying simpler approaches work.

**Why it's wrong:** `node-pty` requires native compilation (often broken in CI environments, requires Python, C++ build tools). `zigpty` is smaller but still an extra native dependency. Most modern Rust CLIs respect `FORCE_COLOR` or `CLICOLOR_FORCE`, making PTY unnecessary.

**Do this instead:** Start with `FORCE_COLOR=1` env var approach. If ccusage doesn't support it (to be verified during implementation), fall back to either: a) Accept non-colored output (functional, just less pretty), or b) Add `zigpty` as an optional/fallback dependency only if colored output is deemed critical for UX.

## Integration Points

### External Services (Future)

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Exchange rate API | `fetch()` with 12h TTL cache in `~/.ccusage-cn/cache` | MVP: env var only. Phase 3: optional live API. |
| (None required for MVP) | | |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `cli.ts` ↔ `binary-resolver.ts` | Async function call: `resolveBinary(): string` | Returns resolved binary path |
| `cli.ts` ↔ `spawner.ts` | Async function call: `createSpawner(path, args, env)` | Returns `{promise: Promise<number>}` |
| `cli.ts` ↔ `exchange-rate.ts` | Async function call: `getExchangeRate(): number` | Returns exchange rate |
| `spawner.ts` ↔ `output-transform.ts` | Stream pipe: `child.stdout → transform → process.stdout` | Streaming, no backpressure issues expected |
| `spawner.ts` → stderr | Direct inheritance: `child.stderr → process.stderr` | Unmodified pass-through |
| `spawner.ts` → exit code | Event: `child.on('exit') → process.exit(code)` | Synchronous propagation |

### Build Order

The components can be built independently in this order due to clear dependency graph:

```
Phase 1: exchange-rate.ts       (no deps)
Phase 1: output-transform.ts    (depends on exchange-rate concept only)
Phase 1: binary-resolver.ts     (no deps)
Phase 2: spawner.ts             (depends on all three above conceptually)
Phase 2: cli.ts                 (wires everything together)
Phase 3: test suite             (fixtures require real ccusage output captured)
Phase 4: npm packaging          (CI, publish automation)
```

## Sources

- [ccusage Architecture Overview (DeepWiki)](https://deepwiki.com/ccusage/ccusage/2-architecture-overview) — HIGH confidence
- [ccusage TypeScript CLI Wrapper (DeepWiki)](https://deepwiki.com/ccusage/ccusage/2.3-typescript-cli-wrapper) — HIGH confidence
- [ccusage Distribution & Packaging (DeepWiki)](https://deepwiki.com/ccusage/ccusage/4-distribution-and-packaging) — HIGH confidence
- [ccusage CLI Wrapper Source (cli.js)](https://github.com/ccusage/ccusage/blob/main/apps/ccusage/src/cli.js) — HIGH confidence, upstream source
- [ccusage Test File (cli.test.ts)](https://github.com/ccusage/ccusage/blob/main/apps/ccusage/src/cli.test.ts) — MEDIUM confidence, test patterns verified
- [ccusage CLI Output Examples (ccusage.com)](https://ccusage.com/guide/cli-options) — MEDIUM confidence, official docs
- [FORCE_COLOR spec (force-color.org)](https://force-color.org) — MEDIUM confidence, community standard
- [Rust supports-color crate: FORCE_COLOR handling (Chromium source)](https://chromium.googlesource.com/chromium/src/+/591a0f30c5eac93b6a3d981c2714ffa4db28dbcb/third_party/rust/supports_color/v1/crate/src/lib.rs) — HIGH confidence, verified source code
- [Rust termcolor crate: FORCE_COLOR discussion (issue #71)](https://github.com/BurntSushi/termcolor/issues/71) — MEDIUM confidence, not all crates support it yet
- [uv/ruff: FORCE_COLOR support implementation](https://github.com/astral-sh/uv/commit/1b3200b2af9cebc86a78f30d585b0f65be0c3091) — HIGH confidence, major project using it
- [Node.js child_process.spawn + Transform stream](https://nodejs.org/docs/latest/api/child_process.html) — HIGH confidence, official docs
- [ccusage output table format examples (aizones.io)](https://aizones.io/tool/how-to-use-ccusage-master-claude-code-costs) — MEDIUM confidence, verified against multiple sources

---
*Architecture research for: ccusage-cn CLI wrapper/adapter for USD→CNY localization*
*Researched: 2026-07-08*
