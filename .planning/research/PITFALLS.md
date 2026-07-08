# Pitfalls Research

**Domain:** npm CLI wrapper wrapping a native Rust binary (ccusage)
**Researched:** 2026-07-08
**Confidence:** HIGH (findings verified against real-world npm binary wrapper failures, upstream ccusage architecture analysis, and exchange rate API patterns)

## Critical Pitfalls

### Pitfall 1: Upstream ccusage Output Format Change Breaks USD-to-CNY Conversion

**What goes wrong:**
The wrapper intercepts ccusage's stdout, parses cost values in USD, and replaces them with CNY equivalents. If ccusage changes its output format (JSON field names, text table layout, column positions, currency label strings), the wrapper silently produces incorrect output, partial conversions, or crashes.

**Why it happens:**
The wrapper is a thin adapter that depends on the stability of ccusage's display layer. The upstream project has no obligation to maintain output format stability — they focus on correctness of data, not machine-parseability of human-readable output. Rust CLI tools commonly reformat output between minor releases as UX is refined.

**How to avoid:**
Exclusively use `ccusage --json` output as the parsing source, not the text table output. JSON has a defined schema that can be validated. Implement a JSON schema validation step that runs before any conversion: validate that expected fields (e.g., costs, currency labels) exist with expected types. If validation fails, fall through to pass raw output through unmodified rather than crashing or showing wrong data.

**Warning signs:**
- CI green but manual testing shows "$" symbols still present in output
- Conversion silently skips certain cost lines
- JSON parse errors after `bunx ccusage --json` is piped through the wrapper

**Phase to address:**
Phase 1 (Core Wrapper) — schema validation must be built in from day one, not retrofitted.

---

### Pitfall 2: Stdout Parsing Poisoned by Diagnostic Output

**What goes wrong:**
ccusage (or dependencies it calls) may write diagnostic messages, progress bars, update notifications, or warning messages to stdout instead of stderr. These non-data lines contaminate the output stream and break JSON parsing or text pattern matching. This is the single most common failure pattern in CLI wrappers (confirmed across piano#412, envault#85, penumbra#1642, OpenRouter spawn#2918).

**Why it happens:**
Rust developers sometimes use `println!()` for warnings instead of `eprintln!()`. Libraries may write to stdout. Auto-update mechanisms, configuration file location messages, or deprecation warnings all commonly leak into stdout.

**How to avoid:**
Never assume the first N lines of stdout are valid data. Parse incrementally: separate JSON output by collecting to a complete JSON blob, or parse text output line-by-line with resilient pattern matching. For JSON mode, accumulate all stdout into a buffer and attempt JSON parse on the complete buffer — if parse fails, check stderr for error context.

**Warning signs:**
- `--json` output occasionally starts with a warning line
- Wrapper sometimes shows "Received invalid data" errors
- Piping through `| jq` breaks when piped directly but works through the wrapper

**Phase to address:**
Phase 1 (Core Wrapper) — output parsing must be resilient to interleaved diagnostics.

---

### Pitfall 3: Signal Passthrough Failure (Ctrl+C Kills Wrapper But Not Binary)

**What goes wrong:**
User presses Ctrl+C during `bunx ccusage-cn -b`. The Node.js wrapper process receives SIGINT, terminates, but the underlying ccusage Rust process continues running in the background as an orphan. The user must manually kill it, and future runs may fail due to locks or port conflicts.

**Why it happens:**
Node.js `child_process.spawn()` does not automatically forward signals. When the parent process exits, the child is reparented to init (PID 1) if not explicitly killed. The default `SIGINT` handler in Node exits the process rather than forwarding the signal to children.

**How to avoid:**
Use `foreground-child` package (20M+ weekly downloads, purpose-built for this) which handles signal forwarding, process group management, and exit code propagation. Alternatively, implement explicit signal handlers:
- `process.on('SIGINT', () => child.kill('SIGINT'))`
- `process.on('SIGTERM', () => child.kill('SIGTERM'))`
- On Windows, use `child.kill()` without a specific signal (Windows doesn't support SIGINT natively).

**Warning signs:**
- Running `bunx ccusage-cn -b` and pressing Ctrl+C, then running `ps aux | grep ccusage` shows a lingering process
- Users report "port already in use" on second run
- Process list shows orphaned ccusage processes

**Phase to address:**
Phase 1 (Core Wrapper) — signal handling is a fundamental requirement for CLI tools.

---

### Pitfall 4: Windows npm Shim Breaks on Native Binary `bin` Entry

**What goes wrong:**
If the wrapper's `package.json` `bin` field points directly to the ccusage native binary (or if the wrapper script doesn't handle Windows correctly), Windows users get broken `.cmd` shims that call `/bin/sh` (which doesn't exist) or try to run a binary through `node.exe`, resulting in "command not found" or silent failures.

**Why it happens:**
npm generates three wrapper files for each `bin` entry: `.cmd`, `.ps1`, and a Bash script. If the target is a native binary, the `.cmd` shim wraps `node.exe` around it, which fails. This is verified by agent-browser#262 (Windows npm shims broken) and pnpm/action-setup#217 (`.cmd` wrappers invoke `node` on native `.exe`).

**How to avoid:**
The wrapper's `bin` entry must point to a Node.js script (`.js`), not a native binary. The Node.js script uses `process.platform` to locate and spawn the correct ccusage binary with `execa` or `child_process.spawn()`. This ensures cross-platform compatibility regardless of npm's shim generation.

**Warning signs:**
- Windows users report `ccusage-cn` command not found after global install
- `npm install -g ccusage-cn` succeeds but the binary doesn't run on Windows
- CI tests pass on macOS/Linux but fail on Windows

**Phase to address:**
Phase 1 (Core Wrapper) — Windows compatibility must be tested from the first publish.

---

### Pitfall 5: Exchange Rate API Outage Causes Complete Failure

**What goes wrong:**
The real-time exchange rate API (open.er-api.com, FreeCurrencyAPI, etc.) is down, rate-limited, or returns stale data. The wrapper either crashes with an API error, hangs waiting for a response, or shows incorrect conversion rates. Blocking on API calls at startup adds latency to every invocation.

**Why it happens:**
Free-tier exchange rate APIs have no SLA. They rate-limit aggressively, have daily update windows, and occasional downtime. Many free APIs limit base currency to USD. Some require attribution. Without a caching and fallback strategy, every invocation is a potential failure point.

**How to avoid:**
Implement a multi-tier strategy:
1. **Primary:** Fetch from `open.er-api.com` (no key, battle-tested, 15+ years) or `exchangerate.fun` (hourly updates)
2. **Cache:** Store last successful rate in `~/.ccusage-cn/rate-cache.json` with timestamp. Use cached rate if API fails AND cache is less than 24 hours old.
3. **Fallback:** If both API and cache fail, use a hardcoded safe default rate (e.g., 7.2) with a prominent warning message
4. **Configurable:** Allow user to set `CCUSAGE_CN_RATE=7.25` environment variable to bypass all API calls

**Warning signs:**
- First run of the day hangs for 3+ seconds
- Users behind corporate proxies get API timeouts
- CI environments without internet access fail
- Exchange rate doesn't update for days (cache not expiring)

**Phase to address:**
Phase 1 (Core Wrapper) — rate fetching and caching is an intrinsic part of the wrapper's value. Skipping it means USD output with no conversion.

---

### Pitfall 6: Argument Forwarding Breaks on Edge Cases

**What goes wrong:**
Commands like `bunx ccusage-cn --help`, `bunx ccusage-cn --json`, `bunx ccusage-cn blocks --active --period week`, or `bunx ccusage-cn -- -b` fail because arguments are misparsed, double-quoted, stripped, or not forwarded to the underlying binary. Users get unexpected behavior or error messages from the wrong command.

**Why it happens:**
Simple `process.argv.slice(2)` works for simple cases but fails on edge cases:
- Flags with arguments: `--period week` (needs to be two separate args, not `"--period week"`)
- `--help` and `--version` intercepted by the wrapper before reaching ccusage
- `--` separator swallowed by shell or the wrapper
- Spaces in argument values

**How to avoid:**
- Use `process.argv.slice(2)` as the argument array passed to `child_process.spawn()` (NOT `exec()` — avoid shell interpretation)
- Use `stdio: 'inherit'` to preserve terminal interaction for `--help` pages and interactive modes
- For the wrapper's own `--help` and `--version`, forward them to ccusage's help/version unless the wrapper specifically needs its own (which it probably shouldn't for maximum compatibility)
- Test with upstream examples: `-b`, `blocks --active`, `blocks --recent`, `--json`, `--help`, `--version`

**Warning signs:**
- `bunx ccusage-cn --help` shows wrapper help instead of ccusage help
- `bunx ccusage-cn --json` returns text instead of JSON (wrapper stripped the flag)
- Arguments with spaces cause unexpected behavior

**Phase to address:**
Phase 1 (Core Wrapper) — argument passthrough must be tested with the full matrix of upstream commands.

---

### Pitfall 7: Npm Lockfile Platform Lock-In Breaks CI/CD

**What goes wrong:**
The `optionalDependencies` for upstream ccusage platform binaries are pinned in `package-lock.json` to the developer's platform (e.g., macOS arm64). When CI/CD on Linux tries to `npm ci`, it can't resolve `@ccusage/ccusage-darwin-arm64` and fails or installs the wrong binary.

**Why it happens:**
npm's lockfile records platform-specific optional dependencies. If the lockfile is generated on macOS, it may only include the macOS entries. On Linux, `npm ci` tries to satisfy the lockfile and fails if platform entries don't match.

**How to avoid:**
This is an upstream issue with ccusage's packaging, but our wrapper depends on it. Mitigations:
- Do NOT commit `package-lock.json` (use `npm-shrinkwrap.json` instead, which is more flexible, or simply omit it)
- Use pnpm which handles platform-specific optional deps better
- In CI, use `npm install --no-optional` and let the upstream handle it
- Test `npm ci` on all three platforms in CI

**Warning signs:**
- CI on Linux fails with `Unsupported platform for @ccusage/ccusage-darwin-arm64`
- `npm ci` succeeds locally but fails in Docker/Linux CI
- Lockfile contains platform-specific entries not relevant to the build machine

**Phase to address:**
Phase 2 (CI/CD & Publishing) — CI must test the package resolution on all target platforms.

---

### Pitfall 8: Upstream Binary Path Resolution Failure

**What goes wrong:**
The wrapper tries to `require.resolve('ccusage')` or spawn `npx ccusage`, but ccusage's binary location is inconsistent across package managers (npm, pnpm, bun, yarn) and installation modes (global vs local, `npx` vs explicit install). The wrapper fails to find the binary.

**Why it happens:**
npm packages resolve binary locations differently:
- `require.resolve('ccusage')` resolves to the main entry point, not the binary
- `npx ccusage` works in interactive terminals but not in spawned processes
- pnpm uses a different `node_modules` structure with hoisting differences
- Global installs place binaries in a different prefix

**How to avoid:**
Use `import-meta-resolve` or `resolve-bin` to locate the ccusage binary. Determine the path via:
1. Check `node_modules/.bin/ccusage` relative to the wrapper's location
2. Fall back to `require.resolve('ccusage/package.json')` and parse the bin field to get the binary path
3. Fall back to spawning `npx ccusage` (slow, network-dependent)
4. Use `cross-spawn` or `execa` for cross-platform process spawning

**Warning signs:**
- `bunx ccusage-cn` works but `npm run ccusage-cn` doesn't
- Wrapper reports "ccusage binary not found"
- Works in development directory but fails when installed globally

**Phase to address:**
Phase 1 (Core Wrapper) — binary resolution strategy must be tested with npm, pnpm, and bun.

---

### Pitfall 9: Exit Code Non-Propagation Breaks Script Chaining

**What goes wrong:**
ccusage exits with code 1 on error (e.g., no logs found, invalid arguments). The wrapper swallows this exit code and exits with 0. Shell scripts using `&&` or `set -e` fail to detect the error, masking failures.

**Why it happens:**
The default behavior of `child_process.spawn()` does not propagate exit codes. If the wrapper always exits with 0 (its own success), the child's failure is hidden. This is especially dangerous in CI pipelines where exit codes determine build status.

**How to avoid:**
Always propagate the child process exit code:
```js
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
```
`execa` and `foreground-child` handle this automatically. Never wrap the child process in a `try/catch` that masks exit codes.

**Warning signs:**
- `bunx ccusage-cn invalid-arg && echo "success"` prints "success" even on error
- CI passes when ccusage should have failed (no logs found)
- Users report "ccusage-cn says error but exits normally"

**Phase to address:**
Phase 1 (Core Wrapper) — exit code propagation is a correctness requirement.

---

### Pitfall 10: ANSI Escape Code and Color Corruption During Conversion

**What goes wrong:**
ccusage uses colored output with ANSI escape codes for terminal display. The wrapper attempts to parse cost values but inadvertently corrupts or strips ANSI codes, breaking the colored output. Or the wrapper applies regex replacement that matches parts of ANSI sequences instead of cost values.

**Why it happens:**
ANSI escape codes are interspersed with text. A cost value like `\x1b[32m$12.34\x1b[0m` (green text) contains escape codes before and after the dollar amount. Simple regex substitution (`$` to `¥`) might match characters inside escape sequences or fail to match due to invisible control characters.

**How to avoid:**
This is a strong argument for using `--json` mode exclusively, which produces plain text JSON without ANSI codes. For text mode, use a streaming line-by-line approach that preserves all non-modified content. If modifying output, strip ANSI codes before parsing, then reapply the same formatting to the modified output. Use libraries like `strip-ansi` and `chalk` for safe ANSI handling.

**Warning signs:**
- Output appears without colors when using ccusage-cn
- Terminal shows garbled characters around cost values
- Cost values have extra "m" or "[32m" artifacts

**Phase to address:**
Phase 1 (Core Wrapper) — if parsing text mode, ANSI handling must be explicit; otherwise, use `--json` mode exclusively.

---

### Pitfall 11: ccusage Binary Version Drift — Wrapper Unaware of Breaking Changes

**What goes wrong:**
ccusage releases v2.0.0 with completely redesigned output format, new JSON schema, different field names. Our wrapper is pinned to `^1.0.0` in `dependencies`, but npm's caret resolution auto-installs v2.0.0 as a minor update (pre-1.0.0 traps) or the user manually updates. The wrapper breaks silently.

**Why it happens:**
- If ccusage is pre-1.0.0 (`0.x`), npm caret (`^0.1.0`) treats every change as breaking — but `^0.2.0` still gets auto-installed
- If ccusage is post-1.0.0, `^1.0.0` auto-accepts minor and patch updates that may contain output format changes
- 70% of npm developers report breaking changes on non-major updates despite SemVer claims (Jafari et al., 2023)

**How to avoid:**
Pin the upstream ccusage dependency to an exact version with `--save-exact`:
```json
"dependencies": {
  "ccusage": "1.2.3"
}
```
Use Renovate or Dependabot with a manual review workflow: the PR body should explicitly mention checking output format compatibility. Run schema validation tests in CI when the dependency changes. Consider running `npm diff --json` on the ccusage package before updating to detect output format changes.

**Warning signs:**
- Dependabot/Renovate opens a PR updating ccusage — no manual review step exists
- `package.json` uses `^` or `~` range for ccusage
- Tests pass but manual inspection shows broken output

**Phase to address:**
Phase 2 (CI/CD & Publishing) — version pinning strategy and update workflow.

---

### Pitfall 12: Bunx Intermittent Binary Resolution Failures

**What goes wrong:**
`bunx ccusage-cn` sometimes works, sometimes fails with "could not determine executable" or similar errors. Users on Bun get inconsistent behavior depending on their Bun version, lockfile state, or whether `bun install` was run.

**Why it happens:**
Bun has known issues (verified by bun#21989, bun#30209, bun#11073): 
- Bun doesn't create `.bin` symlinks when migrating from `yarn.lock`
- Isolated linker (`--linker isolated`) intermittently omits `.bin` symlinks
- In Docker, Bun fails to follow symlinks for require() resolution
- `bunx` lacks `--package` flag equivalent to `npx -p`

**How to avoid:**
Structure the wrapper package so that `bunx ccusage-cn` works reliably:
- Ensure the `bin` entry in `package.json` is robust (pointing to a JS file, not a native binary)
- Test with `bunx ccusage-cn` in CI (not just `npx`)
- For the bunx `--package` limitation, ensure the package exports its binary correctly so bunx can detect it without needing `--package`
- Document that users should run `bun install -g ccusage-cn` for reliable global installs rather than relying on `bunx`

**Warning signs:**
- User reports "bunx ccusage-cn works on my Mac but not in Docker"
- Intermittent failures that are hard to reproduce
- Different behavior between `npx ccusage-cn` and `bunx ccusage-cn`

**Phase to address:**
Phase 2 (CI/CD & Publishing) — CI must test with bun, not just npm.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Regex-based USD-to-CNY conversion on text output | Quick to implement, no JSON needed | Breaks on any output format change; false positives on legitimate "$" in paths or comments | Never — use `--json` mode exclusively from day one |
| Hardcoded exchange rate (e.g., `const RATE = 7.2`) | Zero API dependencies, no latency | Rate goes stale, users get wrong cost projections, erodes trust | Only as fallback when cache + API both fail, with prominent warning |
| `child_process.exec()` with shell=true instead of `spawn()` | Easier string argument handling, pipes work | Shell injection risk, argument escaping bugs, signal forwarding broken | Never — use `spawn()` or `execa` |
| Pinning upstream ccusage at `*` or `>=x` | Automatically get all updates | Breaking output format changes reach users instantly with no testing | Never — pin exact version, use Renovate with manual review |
| Single-line passthrough for `--json` output | Simple implementation | Breaks if upstream adds diagnostic messages before JSON; no validation | Never — validate JSON schema before processing |
| Skip Windows CI testing | Faster development | Windows users get broken package on first publish | Never — cross-platform is a hard requirement |
| No caching for exchange rate | Simpler code | Every invocation hits API = latency + rate limits + offline failure | Never — cache is essential for CLI responsiveness |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Exchange rate API (`open.er-api.com`) | Fetch on every invocation, synchronous HTTP | Fetch once, cache locally with ~/.ccusage-cn/rate-cache.json, refresh on configurable interval |
| Exchange rate API (rate-limited tier) | No retry with backoff | Implement exponential backoff with jitter for 429 responses |
| Exchange rate API (key-based) | Hardcode API key in source | Use environment variable `CCUSAGE_CN_EXCHANGE_API_KEY`, validate at runtime |
| ccusage binary resolution | Assume `ccusage` is on PATH | Use `import-meta-resolve` or `resolve-bin` to find exact path from `node_modules/ccusage` |
| stdin forwarding | Not forwarding stdin | Set `child.stdin = process.stdin` so piping works: `echo '{}' \| ccusage-cn` |
| stdout/stderr separation | Merging stdout and stderr | Keep them separate; let stderr pass through without modification (it carries errors) |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| HTTP request for exchange rate on every command invocation | 1-3 second latency per call, daily limits exhausted | Cache rate locally, refresh every 24h or configurable interval | ~50+ invocations/day with free API (varies by API tier) |
| Executing `npx ccusage` instead of direct binary path | 2-5 second `npx` package resolution overhead per call | Resolve ccusage binary path once at startup, use cached path | Every invocation (not a scale issue, a UX issue from day one) |
| Buffering entire stdout before processing for large reports | High memory usage for reports with months of data | Stream output line-by-line with transform piping | Reports spanning 6+ months of data |
| Spawning a new process for rate fetch when using --json mode | Two processes (rate check + ccusage) for a single user command | Deferred fetch: fetch rate at most once per process lifetime | Every invocation that doesn't have cached rate |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Shell execution (`child_process.exec(shell=true)`) with user-provided args | Argument injection: `bunx ccusage-cn -- --help; rm -rf /` | Use `spawn()` with array arguments, never shell string |
| Passing exchange API key via command-line flag | API key visible in `ps aux`, logs, CI output | Read API key from environment variable or config file with 0600 permissions |
| Downloading exchange rate over HTTP (not HTTPS) | Man-in-the-middle can inject manipulated rates | Always use HTTPS for API calls |
| Caching rate data in world-readable file | Other users on multi-user system can read API traffic patterns | Store cache in `~/.ccusage-cn/` with 0700 permissions |
| Not verifying integrity of resolved ccusage binary | Possible path traversal or malicious binary substitution | Verify resolved path is inside `node_modules/ccusage/` directory |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| API rate fetch blocks startup | "Why does this take 3 seconds to show help?" | Show help immediately, fetch rate lazily / in background |
| No indicator that conversion occurred | User sees ¥ values but doesn't know the rate used | Always show `(# rate: 1 USD = 7.25 CNY, updated 2026-07-08 10:00)` |
| Cached rate is very stale with no warning | User makes decisions based on old rate | Show stale rate with "(cached 3 days ago)" warning in output |
| Converting output that should not be converted | User runs `--json` and internal config values (not costs) get converted | Use JSON schema to identify which fields are costs; only convert known fields |
| Output looks different from upstream ccusage | User suspects the wrapper changed behavior beyond currency | Keep output identical to upstream in structure, only change currency symbols |
| Rate fetch failure with no fallback | Wrapper crashes entirely; user can't use the tool | Fall through to pass ccusage output unmodified (still in USD) with a warning |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [x] **--help passthrough:** Often missing — wrapper intercepts --help and shows wrapper docs instead of forwarding to ccusage. Verify `bunx ccusage-cn --help` shows the same output as `bunx ccusage --help`.
- [ ] **Exit code propagation:** Often missing — wrapper exits 0 even when ccusage fails. Verify `bunx ccusage-cn nonexistent-command` exits with non-zero code.
- [ ] **stdin forwarding:** Often missing — `echo '{"tool":"claude"}' | bunx ccusage-cn` should pipe through correctly. Verify piping works.
- [ ] **SIGINT on Windows:** Often missing — Ctrl+C during long-running command on Windows. Test on Windows CI.
- [ ] **Tty detection:** Often missing — wrapper should detect if stdout is a terminal (colored output) vs pipe (plain output) and behave consistently with upstream.
- [ ] **Rate cache expiry on version update:** Often missing — updating the package should invalidate old cached rates. Verify cache TTL resets on package update.
- [ ] **Error message propagation:** Often missing — when ccusage writes errors to stderr, the wrapper swallows them. Verify stderr content is passed through unmodified.
- [ ] **Concurrent invocation safety:** Often missing — two simultaneous `bunx ccusage-cn` calls race on the rate cache file. Use atomic writes with a temp file pattern.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Upstream output format change | MEDIUM | 1) Pin to last working ccusage version. 2) Update JSON schema validation. 3) Release patch with updated parsing. 4) Add integration test with new upstream version. |
| Exchange rate API permanently down | LOW | 1) Cache file still has last known rate. 2) Release patch to switch API provider. 3) User can set `CCUSAGE_CN_RATE` env var in meantime. |
| Broken Windows binary after npm publish | HIGH (affects all Windows users) | 1) `npm unpublish` last version if within 72h. 2) Fix `bin` entry to use Node.js wrapper. 3) Publish patch. 4) Add Windows CI testing. |
| Stale cache with wrong rate | LOW | 1) Delete `~/.ccusage-cn/rate-cache.json`. 2) Set `CCUSAGE_CN_RATE` for immediate fix. 3) Next invocation fetches fresh rate. |
| npx resolution broken by npm update | MEDIUM | 1) The `bin` entry in package.json is the most common cause. 2) Verify bin script has correct shebang. 3) Test with `npx ccusage-cn@latest` on affected platform. |
| Accidental breaking update auto-installed | MEDIUM | 1) Pin ccusage to exact version in next release. 2) Warn users to downgrade with `npm install ccusage@<old-version>`. 3) Add CI check against version drift. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Upstream output format change | Phase 1 (Schema validation + `--json` only) | Integration tests that run against actual ccusage output snapshots |
| Stdout parsing poisoned | Phase 1 (Resilient parsing) | Test with injected diagnostic output lines in fixture data |
| Signal passthrough | Phase 1 (By design with `foreground-child` or manual handlers) | Manual test: Ctrl+C during operation, check for orphan processes |
| Windows shim broken | Phase 1 (Node.js wrapper as bin entry) | Windows CI: install package, run basic command |
| Exchange rate API failure | Phase 1 (Caching + fallback chain + env override) | Test with API unreachable, expired cache, and no cache |
| Argument forwarding | Phase 1 (spawn with argv slice, test matrix) | Test every upstream command pattern: `-b`, `--json`, `--help`, `blocks --active` |
| Lockfile platform lock-in | Phase 2 (CI on Linux + macOS + Windows) | `npm ci` on each platform with fresh lockfile |
| Binary path resolution | Phase 1 (Multiple resolution strategies) | Test with npm, pnpm, bun, global install, local install |
| Exit code propagation | Phase 1 (Always propagate) | Test with invalid args, check exit code is non-zero |
| ANSI code corruption | Phase 1 (Use `--json` mode, avoid text parsing) | Text mode test with colored output fixtures |
| Upstream version drift | Phase 2 (Exact version pinning + Renovate with review) | CI test that schema validation passes with pinned version |
| Bunx resolution issues | Phase 2 (CI test with bun) | `bunx ccusage-cn --help` and `bun run ccusage-cn` in CI |

---

## Sources

- [ccusage/ccusage DeepWiki — Distribution & Packaging](https://deepwiki.com/ccusage/ccusage/4-distribution-and-packaging) — Upstream distribution architecture
- [agent-browser#262: Windows npm shims broken](https://github.com/vercel-labs/agent-browser/issues/262) — Windows shim failure pattern
- [piano#412: Stdout contamination breaks JSON parsing](https://github.com/rocketman-code/piano/issues/412) — Stdout pollution pattern
- [penumbra#1642: Diagnostic info on stdout](https://github.com/penumbra-zone/penumbra/issues/1642) — Same pattern in another Rust CLI
- [OpenRouter spawn#2918: Auto-update stdout pollution](https://github.com/OpenRouterTeam/spawn/issues/2918) — Auto-updater breaks JSON output
- [npm/cli#8896: Global update missing bin entries](https://github.com/npm/cli/issues/8896) — `npm update -g` doesn't recreate .bin shims
- [netlify/cli#7769: Lockfile platform lock-in](https://github.com/netlify/cli/issues/7769) — EBADPLATFORM from platform-specific optional deps
- [Sentry Engineering — Publishing Binaries on npm](https://sentry.engineering/blog/publishing-binaries-on-npm) — Platform-specific npm packages best practices
- [MagicBell — Distributing Platform-Specific Binaries with npm](https://www.magicbell.com/blog/distributing-platform-specific-binaries-with-npm) — Runtime download vs postinstall analysis
- [foreground-child (npm)](https://www.npmjs.com/package/foreground-child) — Signal and exit code forwarding
- [ExchangeRate-API Free Endpoint](https://open.er-api.com/) — Free USD/CNY rate with no API key
- [FreeExchangeRateApi (GitHub)](https://github.com/haxqer/FreeExchangeRateApi) — Hourly free exchange rate API
- [He, Vasilescu, Kastner (2025) — Pinning Is Futile](http://arxiv.org/pdf/2502.06662) — Dependency pinning trade-offs study
- [Jafari et al. (2023) — Dependency Update Strategies](https://arxiv.org/pdf/2305.15675) — 70% experience breaking changes on non-major updates
- [bun#21989: Missing .bin after yarn.lock migration](https://github.com/oven-sh/bun/issues/21989) — Bun lockfile migration breaks bin entries
- [bun#30209: Intermittent missing .bin symlinks](https://github.com/oven-sh/bun/issues/30209) — Bun isolated linker non-determinism
- [bun#11073: Symlink resolution failure in Docker](https://github.com/oven-sh/bun/issues/11073) — Bun require() resolution from .bin broken in Docker
- [Cross-platform Node.js Guide — Package binaries](https://raw.githubusercontent.com/ehmicky/cross-platform-node-guide/main/docs/4_terminal/package_binaries.md) — npm `bin` field cross-platform behavior
- [pm2: Node.js process signal handling](https://pm2.io/docs/runtime/features/graceful-shutdown/) — Signal handling patterns for Node.js child processes

---
*Pitfalls research for: ccusage-cn (npm CLI wrapper around ccusage native binary)*
*Researched: 2026-07-08*
