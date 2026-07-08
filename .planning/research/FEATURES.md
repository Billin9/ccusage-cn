# Feature Research

**Domain:** CLI 本地化包装工具 / CLI Localization Wrapper (USD-to-CNY)
**Researched:** 2026-07-08
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

用户将 ccusage-cn 视为 `bunx ccusage` 的替换品。以下功能若缺失，工具感觉不完整。

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **100% CLI 参数透传** | 所有上游命令和标志必须按预期工作。用户不想学习两套 CLI。 | MEDIUM | 需持续跟踪上游 CLI 接口变更。难点在于上游是 Rust 二进制，无法简单 import。 |
| **USD cost → CNY cost 展示** | 核心价值。所有费用展示以 `¥` 而非 `$` 显示。 | LOW | 替换文本中的美元符号和数字。但需注意：多货币格式、大数字、极小数字（如 $0.0003）。 |
| **JSON 输出中的 CNY 字段** | 脚本用户（shell/pipeline）依赖 `--json` 的结构化输出。 | LOW | JSON 是结构化数据，转换比文本可靠。需决定：替换 costUSD 值还是添加 costCNY 新字段。 |
| **上游命令兼容性维持** | 上游新增命令（如新的时间聚合视图）必须自动可用。 | HIGH | 这是最难的表定功能。与实现策略紧密相关：pipe-wrapper 自然继承，而 adapter 需手写映射。 |
| **上游配置兼容性** | `ccusage.json` 配置（自定义定价、路径等）必须继续工作。 | MEDIUM | 取决于实现方式。config 注入到上游进程或 wrapper 自行解析。 |
| **安装方式一致** | `bunx ccusage-cn` 等于 `bunx ccusage` 的使用体验。 | LOW | npm 包发布即可。注意包名、二进制名、bin 入口配置。 |
| **彩色表格兼容** | 上游使用 ANSI 彩色表格。转换后必须保留色彩和排版的视觉保真度。 | MEDIUM | 文本后处理容易破坏 ANSI 转义序列。JSON+重新渲染或 ANSI-aware 正则。 |
| **Offline 模式兼容** | `--offline` 标志必须仍能工作，且离线时 RMB 转换也能运行（使用缓存汇率）。 | LOW | 上游离线模式不影响包装层。汇率需有本地缓存才能离线。 |

### Differentiators (Competitive Advantage)

能让 ccusage-cn 比用户自己 `bunx ccusage | awk '{...}'` 更值得使用的功能。

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **可配置汇率源** | 支持实时 API（Frankfurter、ExchangeRate-API）、手动设定、环境变量、配置文件。用户不依赖单一硬编码值。 | MEDIUM | scx 使用 Frankfurter API。建议支持：CLI flag > env var > config > fallback rate > 硬编码默认值。 |
| **`--rate <number>` CLI 标志** | 单次执行指定汇率：`bunx ccusage-cn --rate 7.25`。无需跑两步。 | LOW | 参考 scx 的 `-r/--rate`。直接覆盖所有其他汇率来源。 |
| **汇率缓存 + 过期警告** | 缓存汇率避免每次请求 API。缓存超过 N 小时（默认 24h）时显示警告 "汇率数据来自 X 小时前"。 | LOW | 写入 `~/.ccusage-cn/cache/rate.json`。缓存时间和来源显示在 --version 或独立命令中。 |
| **中文区域格式化** | 使用 `Intl.NumberFormat('zh-CN', {style:'currency', currency:'CNY'})` 而非通用格式。正确处理大数字（￥1,234.56 而非 $1,234.56）。 | LOW | 如果是 Node.js 实现，直接使用内置 Intl API。若是其他语言需 ICU 绑定。 |
| **`--cost-unit` 格式化选项** | 用户可控制费用显示单位（元 vs 分 vs 万元）。对大额费用更直观。 | LOW | 可选：元（默认）、分、万元。例如 ¥15,678.90 → ¥1.57万。 |
| **`ccusage-cn statusline` 本地化** | 上游 `statusline` 命令用于 Claude Code 状态栏。其费用也必须本地化。 | MEDIUM | 同其他命令一样处理，但格式不同（紧凑单行输出）。 |
| **汇率来源透明度** | `--version` 或 `ccusage-cn rate` 命令显示当前使用的汇率、来源、上次更新时间。 | LOW | 增加用户信任。示例：`Rate: 7.2500 CNY/USD (Frankfurter API, updated 2026-07-08T10:00:00Z)`。 |
| **MCP Server 本地化（如有）** | 若上游实现 MCP Server，其返回的费用数据也需要本地化。 | MEDIUM | 需识别上游 MCP 接口并包装。但上游 MCP 功能尚在开发/实验阶段。 |
| **更新检查器** | 检查上游新版本并通知用户：`New ccusage upstream v20.1.0 available`。 | LOW | 单纯版本号比较。同 npm registry 查询。 |
| **`--currency-display` 双币种展示** | 同时显示 CNY 和 USD 价格：`¥0.036 ($0.005)`。便于交叉核对。 | LOW | 用户可选的增强显示模式。默认单 CNY，加 flag 后显示双币。 |

### Anti-Features (Commonly Requested, Often Problematic)

看起来有用但实际会带来问题的功能。

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **多币种支持** | "为什么不支持欧元、日元等？更通用。" | 范围扩大后需要：维护多个汇率源、区域格式映射、用户选择器。维护成本x3。偏离 "中国开发者" 核心定位。 | 坚守 CNY only。多币种用户应使用上游 + scx。 |
| **Fork 上游源码改 Rust 代码** | "直接改上游的 costUSD 计算逻辑，确保一致性。" | 持续合并上游变更的噩梦。很快落后几个版本。无法继承新 source 和修复。 | Wrapper/Adapter 模式。不改一行上游代码。 |
| **添加新的 AI 工具支持** | "中国开发者用好多国内 AI 工具，加一下支持。" | 上游已支持 15+ 工具且持续增加。这是上游的职责范围。 | Wrapper 自动继承上游新 source。如有必要，可向上游 PR 贡献新 source。 |
| **自定义费率计算引擎** | "想用不同的定价模型，不依赖 LiteLLM。" | 改变了核心语义。用户对费用数字的信任会崩塌（"为什么我算出来和官方不同？"）。 | 使用上游 `ccusage.json` 的 `pricing` 覆盖功能。不另造轮子。 |
| **Web/GUI 仪表盘** | "可视化不够好，想有网页界面看历史趋势。" | 完全不同的产品领域。工程投入巨大。 | 用户可 pip 到 `ccusage --json | ...` 或使用上游社区工具。 |
| **汇率走势图/预测** | "想看到汇率历史趋势，方便计划何时用 AI。" | 偏离核心价值。数据源、缓存、图表渲染复杂度高。几乎无人需要。 | 汇率只为费用计算存在。不提供金融分析功能。 |
| **批量历史汇率转换** | "导入去年的日志，用当时的实际汇率转换。" | 需要历史汇率 API（付费）或数据库。逻辑复杂度暴涨。 | 使用单一汇率（用户指定或当日 API 汇率）。年度对比本身可接受近似值。 |

## Feature Dependencies

```
[CLI 参数透传]
    ├──requires──> [上游二进制调用机制]
    │                   └──requires──> [上游安装/版本管理]
    │
    └──requires──> [输出解析引擎]
                        ├──requires──> [文本输出解析] (ANSI-aware)
                        └──requires──> [JSON 输出解析]

[RMB 费用展示]
    ├──requires──> [汇率管理]
    │                   ├──requires──> [实时汇率 API]
    │                   ├──requires──> [缓存读写]
    │                   └──optionally──> [手动汇率覆盖 (--rate / env var)]
    │
    └──enhances──> [中文区域格式化]

[JSON 输出本地化]
    └──requires──> [JSON 输出解析]

[Statusline 本地化]
    └──requires──> [RMB 费用展示]

[双币种展示]
    └──enhances──> [RMB 费用展示]

[更新检查]
    └──independent──> [所有其他功能]

[汇率来源透明度]
    └──requires──> [汇率管理]
```

### Dependency Notes

- **CLI 参数透传 要求 上游二进制调用:** 这是根本依赖。不能 import Rust 模块，必须执行上游二进制进程并捕获输出。
- **输出解析引擎 是瓶颈:** 所有后续功能（RMB 展示、JSON 本地化）都需要先解析上游输出。解析失败则整个工具失效。
- **汇率管理 是核心数据依赖:** RMB 展示的质量直接受汇率精度、来源可靠性、更新频率影响。
- **双币种展示 增强 RMB 展示:** 需要同时维护两组数字，增加 UI 空间，但用户可验证转换准确性。

## MVP Definition

### Launch With (v1)

绝对最小可行产品 — 验证核心假设所必需的。

- [X] **CLI 参数透传** — 所有上游命令通过 wrapper 执行，参数传递无误。这是基石。
- [X] **基础 RMB 费用展示** — 美元费用通过固定汇率或环境变量汇率转换为人民币。核心价值。
- [X] **JSON 输出本地化** — `--json` 输出中 cost 字段转换为 CNY。脚本用户的关键需求。
- [X] **`bunx ccusage-cn` 安装** — npm 包发布，可用 `bunx` 直接运行。
- [X] **彩色表格兼容** — wrapper 不破坏上游的 ANSI 彩色输出。
- [X] **Offline 模式** — `--offline` 结合缓存汇率正常工作。

**v1 的取舍:** 汇率源仅支持环境变量或默认固定值。没有实时 API 集成。没有 statusline 本地化。没有双币种。没有更新检查。

### Add After Validation (v1.x)

核心功能验证了产品方向后添加。

- [ ] **实时汇率 API 集成** — 用户反馈 "每次手动设汇率太麻烦" 时添加。使用 Frankfurter API（免费，无需 API key）。
- [ ] **汇率缓存 + 过期预警** — 网络请求时自动缓存。离线时用缓存。缓存过期显示警告。
- [ ] **`--rate` CLI 标志** — 单次覆盖汇率。用户常见需求。
- [ ] **Statusline 本地化** — 上游 statusline 命令用户请求本地化。
- [ ] **更新检查器** — 上游新版本通知，避免用户持续使用旧版。

### Future Consideration (v2+)

产品市场匹配确认后再考虑。

- [ ] **双币种展示模式** — 需要用户研究确认是否真有需求。
- [ ] **汇率来源透明度命令** — `ccusage-cn rate` 独立命令。
- [ ] **`--cost-unit` 格式选项** — 万元显示，针对企业用户大额账单。
- [ ] **MCP Server 本地化** — 上游 MCP 功能稳定后。
- [ ] **配置文件中的汇率设置** — 在 `~/.ccusage-cn/config.json` 中持久化汇率配置。

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| CLI 参数透传 | HIGH | MEDIUM | P1 |
| 基础 RMB 费用展示 | HIGH | LOW | P1 |
| JSON 输出本地化 | HIGH | LOW | P1 |
| `bunx ccusage-cn` 安装 | HIGH | LOW | P1 |
| 彩色表格兼容 | HIGH | MEDIUM | P1 |
| Offline 模式 | MEDIUM | LOW | P1 |
| 实时汇率 API | HIGH | LOW | P2 |
| 汇率缓存 + 过期预警 | HIGH | LOW | P2 |
| `--rate` CLI 标志 | MEDIUM | LOW | P2 |
| Statusline 本地化 | MEDIUM | MEDIUM | P2 |
| 更新检查器 | LOW | LOW | P2 |
| 双币种展示 | LOW | LOW | P3 |
| 汇率来源透明度命令 | LOW | LOW | P3 |
| `--cost-unit` 选项 | LOW | LOW | P3 |
| MCP Server 本地化 | MEDIUM | MEDIUM | P3 |
| 配置文件中汇率设置 | MEDIUM | LOW | P3 |

**Priority key:**
- P1: 必须发布 (Must have for launch)
- P2: 尽快添加 (Should have, add when possible)
- P3: 未来考虑 (Nice to have, future consideration)

## Edge Cases & Design Decisions

### 费用字段处理策略

JSON 输出中如何处理 cost 字段的决策：

| 策略 | 做法 | 优劣 |
|------|------|------|
| **覆盖原值** | `costUSD: 5.00` → `costUSD: 36.25` | 简单，但破坏与上游 JSON schema 的兼容性 |
| **追加新字段** | 保留 `costUSD: 5.00`，新增 `costCNY: 36.25` | 向后兼容，脚本可选取。推荐。 |

**推荐:** 追加 `costCNY` 字段，保留所有上游字段不动。这样脚本仍可读取 costUSD，同时有本地化版本。

### 极小金额显示

AI token 费用常出现 $0.0015 这类极小金额。转换为 ¥0.0109 后需要合适的精度：

- 上游显示: `$0.0015`
- 直接转换: `¥0.0109` (4位小数)
- 格式化后: `¥0.01` (丢失精度) 或 `¥0.0109` (保留足够小数)

**建议:** 使用与上游相同的精度逻辑（动态小数位数，≥最小货币单位）。Intl.NumberFormat 默认对 CNY 使用 2 位小数，需要手动处理极小金额。

### 文本模式解析的挑战

上游表格输出包含：
- 彩色 ANSI 转义码
- 对齐的 ASCII 表格边框
- 混合文本和数字

三种解析策略：

| 策略 | 可靠度 | 复杂度 | 说明 |
|------|--------|--------|------|
| 管道文本替换 (sed-like) | LOW | LOW | 匹配 `$数字` 模式替换。可能误匹配非费用字段、破坏格式 |
| ANSI-aware 正则替换 | MEDIUM | MEDIUM | 先剥离 ANSI 码定位费用区域，替换，再还原 ANSI |
| JSON 模式 + 自渲染 | HIGH | HIGH | 调用上游 --json，转换，自行渲染为彩色表格。需重写表格渲染逻辑 |

**推荐 v1:** 文本替换 + JSON 模式双通道。**JSON 模式可靠但需 `--json` 标志**。文本模式用正则替换 `$X.XX` 为 `¥X.XX` 应对默认输出。v2 考虑 JSON + 自渲染以获得最佳效果。

## Competitor Feature Analysis

| Feature | scx (pipe filter) | ccsage (upstream) | Our Approach (ccusage-cn) |
|---------|-------------------|-------------------|--------------------------|
| 安装方式 | `npm install -g @yamamuteki/scx` | `bunx ccusage` | `bunx ccusage-cn` (drop-in) |
| 货币转换 | 任意 ISO 4217 货币 | USD only（上游） | CNY only（wrapper） |
| 汇率来源 | CLI flag > env > config > Frankfurter API | N/A | CLI flag > env > config > API > fallback |
| CLI 参数 | 独立参数（`-c`, `-r`, `-l`） | 原生命令树 | 100% 透传上游参数 |
| 输入方式 | stdin pipe | 直接执行 | 内部调用上游 binary |
| JSON 支持 | 自动检测 + 递归遍历 + 可配 cost key | 原生 `--json` 输出 | 追加 costCNY 字段 |
| 区域格式 | `Intl.NumberFormat(locale, ...)` | 无（仅 USD） | `Intl.NumberFormat('zh-CN', ...)` |
| 离线模式 | 无 | `--offline` | 支持（缓存汇率） |
| 核心定位 | 通用 pipe 货币转换器 | AI token 费用分析 | 对中国的上游本地化包装 |

## Sources

- [ccusage GitHub Repository](https://github.com/ccusage/ccusage) — 上游项目文档和命令参考 (HIGH confidence)
- [scx GitHub Repository](https://github.com/yamamuteki/scx) — 同类 CLI 包装工具参考 (HIGH confidence)
- [ccusage npm Package](https://www.npmjs.com/package/ccusage) — 发布信息和版本 (MEDIUM confidence)
- [ccusage DeepWiki: Command Reference](https://deepwiki.com/ryoppippi/ccusage/2.8-filters-and-options) — 上游命令完整参考 (MEDIUM confidence)
- [ccusage DeepWiki: JSON Output](https://deepwiki.com/cobra91/better-ccusage/6.3.2-json-output) — JSON 输出结构参考 (MEDIUM confidence)
- [ccusage DeepWiki: Cost Calculation Modes](https://deepwiki.com/ryoppippi/ccusage/5.5-cost-calculation-modes) — 定价计算模式 (MEDIUM confidence)
- [ccusage DeepWiki: Configuration Files](https://deepwiki.com/ryoppippi/ccusage/4.1-configuration-files) — 配置文件 schema (MEDIUM confidence)

---
*Feature research for: CLI 本地化包装工具 (USD-to-CNY)*
*Researched: 2026-07-08*
