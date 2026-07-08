# ccusage-cn

[![CI](https://github.com/user/ccusage-cn/actions/workflows/ci.yml/badge.svg)](https://github.com/user/ccusage-cn/actions/workflows/ci.yml)

## 项目简介 / Introduction

**AI 编程 Token 费用，人民币一目了然。** ccusage-cn 是 [ccusage](https://github.com/ccusage/ccusage) 的人民币（CNY）适配版本——一个分析 AI 编程工具 Token 用量的 CLI 工具。它在完全兼容原版 ccusage 所有命令和参数的基础上，将费用展示从美元（USD）转换为人民币（CNY），面向中国开发者提供更直观的成本洞察。

ccusage-cn is the CNY (Chinese Yuan) adaptation of [ccusage](https://github.com/ccusage/ccusage), a CLI tool that analyzes token usage from AI coding assistants. It fully retains all ccusage commands and parameters, converting cost display from USD to CNY for Chinese developers.

---

## 安装方式 / Installation

ccusage-cn 可以通过以下几种方式使用，无需安装即可直接运行：

### 使用 bunx（推荐）

```bash
bunx ccusage-cn -b
```

### 使用 npx

```bash
npx ccusage-cn -b
```

### 全局安装

```bash
npm install -g ccusage-cn
ccusage-cn -b
```

> **提示：** 首次运行 `bunx` 或 `npx` 时会自动下载并安装 ccusage-cn 及其依赖，后续运行将使用缓存。全局安装适合频繁使用场景。

---

## 使用示例 / Usage Examples

以下示例展示 ccusage-cn 的常用命令，所有参数与上游 ccusage 完全一致：

### 查看当前周期账单

```bash
ccusage-cn -b
```

输出中的费用自动以人民币（¥）显示，与 `ccusage -b` 的美元（$）输出格式一致。

### 查看活跃会话区块费用

```bash
ccusage-cn blocks --active
```

### JSON 模式输出

```bash
ccusage-cn --json
```

JSON 输出中保留原始 `costUSD` 字段，并追加 `costCNY` 字段（人民币等值）：

```json
{
  "costUSD": 5.21,
  "costCNY": 37.51
}
```

### 自定义汇率

```bash
CCUSAGE_CNY_RATE=7.25 ccusage-cn -b
```

通过环境变量覆盖默认汇率（7.2），使用自定义汇率进行费用转换。

---

## 环境变量 / Environment Variables

| 变量名 | 类型 | 说明 | 默认值 |
|--------|------|------|--------|
| `CCUSAGE_CNY_RATE` | 数字（可选） | 自定义 USD→CNY 汇率，覆盖默认值 | 7.2 |

汇率回退策略（三层）：

1. **环境变量**：`CCUSAGE_CNY_RATE` 显式设置的值优先级最高
2. **CDN 缓存**：首次联网运行时从免费 API 获取实时汇率并缓存到本地（`~/.ccusage-cn/cache/rate.json`），有效期至下次运行
3. **默认值**：7.2（断网或 API 不可用时使用，不会阻塞输出）

---

## 与上游差异 / Differences from Upstream

ccusage-cn 与上游 ccusage 的核心差异仅为费用显示单位，其余 100% 兼容：

| 方面 | ccusage | ccusage-cn |
|------|---------|------------|
| 费用单位 | 美元（USD，`$X.XX`） | 人民币（CNY，`¥Y.YY`） |
| 文本输出 | `$X.XX` | `¥Y.YY` |
| JSON 输出 | `costUSD` | `costUSD`（保留）+ `costCNY`（追加） |
| 命令/参数 | 全部 | 完全透传，100% 兼容 |
| 输出格式 | 表格/JSON/CSV | 保持原格式，仅费用单位转换 |

**平台验证状态（CI 验证通过 ✅）：**

- macOS（ARM64）：CI 矩阵验证通过
- Linux（x64/ARM64）：CI 矩阵验证通过
- Windows（x64/ARM64）：CI 矩阵验证通过

---

## 兼容的上游版本 / Compatible Upstream Version

- **上游依赖**：`ccusage@^20.0.0`（caret 范围，自动兼容 patch 和 minor 更新）
- **ccusage-cn 版本**：`1.0.0`（独立语义化版本，不与上游版本号关联）

ccusage-cn 使用独立的语义化版本号（SemVer），与上游 ccusage 的版本号无关。上游的 patch 和 minor 更新会被自动兼容，major 更新需要 ccusage-cn 适配后才能支持。

---

## 许可 / License

MIT License — 与上游 ccusage 一致。
