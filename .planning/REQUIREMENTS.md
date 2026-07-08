# Requirements: ccusage-cn

**Defined:** 2026-07-08
**Core Value:** 以最小维护代价，持续继承上游更新，实现 AI 编程 Token 费用的本地货币化展示。

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### CLI 兼容性 (CLI)

- [ ] **CLI-01**: 所有上游 ccusage 命令和参数完全透传，用户使用 `bunx ccusage-cn <args>` 与 `bunx ccusage <args>` 行为一致
- [ ] **CLI-02**: 上游进程的退出码正确传播到 ccusage-cn
- [ ] **CLI-03**: 上游进程的信号（SIGINT、SIGTERM）正确处理和转发，不产生孤儿进程
- [ ] **CLI-04**: `--json` 模式输出的 JSON 结构保持完整，追加 `costCNY` 字段而非覆盖原始 `costUSD`

### 费用转换 (COST)

- [ ] **COST-01**: 文本表格输出中的美元费用（`$X.XX`）自动转换为人民币展示（`¥Y.YY`）
- [ ] **COST-02**: JSON 输出中的费用字段自动追加人民币等值（`costCNY`）
- [ ] **COST-03**: 汇率通过环境变量 `CCUSAGE_CNY_RATE` 可配置
- [ ] **COST-04**: 无网络环境下使用缓存或默认汇率（7.2），不阻塞输出

### 安装与分发 (DIST)

- [ ] **DIST-01**: npm 包 `ccusage-cn` 发布，通过 `bunx ccusage-cn` 可直接运行
- [ ] **DIST-02**: `bunx ccusage-cn` 自动拉取上游 ccusage 及其平台特定二进制依赖
- [ ] **DIST-03**: macOS、Linux、Windows 三平台均可运行

### 输出保真度 (OUT)

- [ ] **OUT-01**: ANSI 彩色输出保留（通过 `FORCE_COLOR=1` 环境变量）
- [ ] **OUT-02**: 表格列对齐在人民币转换后保持合理（不因位数变化导致严重错位）
- [ ] **OUT-03**: `--help` 输出透传上游帮助信息，附加 ccusage-cn 特有选项说明

### 上游更新策略 (UPD)

- [ ] **UPD-01**: 上游 ccusage 作为 npm dependency（`^20.0.0`），patch/minor 更新自动继承
- [ ] **UPD-02**: CI 定期（每周）运行集成测试，检测上游 major 更新是否破坏兼容性

## v2 Requirements

Deferred to future release.

### 实时汇率 (RATE)

- **RATE-01**: 自动从免费汇率 API（Frankfurter）获取实时 USD/CNY 汇率
- **RATE-02**: 汇率磁盘缓存（`~/.ccusage-cn/cache/rate.json`），24h TTL
- **RATE-03**: `--rate <value>` CLI 标志支持单次覆盖汇率
- **RATE-04**: 汇率来源透明度（`--rate-source` 显示当前使用的汇率来源）

### 增强功能 (ENH)

- **ENH-01**: Statusline 命令本地化
- **ENH-02**: 双币种展示模式（同时显示 USD 和 CNY）
- **ENH-03**: 更新检查器（npm registry 版本比较，提示新版本）
- **ENH-04**: `--cost-unit <usd|cny|both>` 格式化选项

## Out of Scope

| Feature | Reason |
|---------|--------|
| 修改上游 ccusage Rust 核心逻辑 | 维护成本高，违背「最小代价继承更新」的核心理念 |
| 多币种支持（除 CNY 外） | 仅面向中国开发者，人民币是唯一目标 |
| 自定义定价模型 | 保持与上游 LiteLLM 定价数据一致 |
| Fork 上游仓库自行维护 | 上游更新频繁（17k+ stars），fork 会导致合并冲突和功能滞后 |
| MCP 服务器本地化 | 依赖上游 MCP 功能稳定，v2+ 考虑 |
| GUI/Web 界面 | 保持纯 CLI 定位，与上游一致 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLI-01 | 阶段 1 | Pending |
| CLI-02 | 阶段 1 | Pending |
| CLI-03 | 阶段 1 | Pending |
| CLI-04 | 阶段 1 | Pending |
| COST-01 | 阶段 1 | Pending |
| COST-02 | 阶段 1 | Pending |
| COST-03 | 阶段 1 | Pending |
| COST-04 | 阶段 1 | Pending |
| DIST-01 | 阶段 2 | Pending |
| DIST-02 | 阶段 1 | Pending |
| DIST-03 | 阶段 2 | Pending |
| OUT-01 | 阶段 1 | Pending |
| OUT-02 | 阶段 1 | Pending |
| OUT-03 | 阶段 1 | Pending |
| UPD-01 | 阶段 1 | Pending |
| UPD-02 | 阶段 3 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-08*
*Last updated: 2026-07-08 after roadmap creation*
