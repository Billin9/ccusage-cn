# ccusage-cn

[![CI](https://github.com/Billin9/ccusage-cn/actions/workflows/ci.yml/badge.svg)](https://github.com/Billin9/ccusage-cn/actions/workflows/ci.yml)

## 项目简介 / Introduction

**AI 编程 Token 费用，人民币一目了然。** ccusage-cn 是 [ccusage](https://github.com/ccusage/ccusage) 的人民币（CNY）适配版本——一个分析 AI 编程工具 Token 用量的 CLI 工具。它在完全兼容原版 ccusage 所有命令和参数的基础上，将费用展示从美元（USD）转换为人民币（CNY），面向中国开发者提供更直观的成本洞察。

ccusage-cn is the CNY (Chinese Yuan) adaptation of [ccusage](https://github.com/ccusage/ccusage), a CLI tool that analyzes token usage from AI coding assistants. It fully retains all ccusage commands and parameters, converting cost display from USD to CNY for Chinese developers.

---

## 快速上手 / Quick Start

```bash
# 一句话查看今日 Claude Code 费用（macOS）
bunx ccusage-cn@latest claude -b --since $(date -v-1d +%Y%m%d)

# Linux 用户替换 date 语法
bunx ccusage-cn@latest claude -b --since $(date -d '1 day ago' +%Y%m%d)
```

首次运行 `bunx` 会自动下载并缓存，后续运行秒开。

---

## 安装方式 / Installation

无需安装即可直接运行：

### bunx（推荐）

```bash
bunx ccusage-cn@latest <args>
```

### npx

```bash
npx ccusage-cn@latest <args>
```

### 全局安装（适合频繁使用）

```bash
npm install -g ccusage-cn
ccusage-cn <args>
```

---

## 常用命令 / Common Commands

ccusage-cn 完整兼容上游 ccusage 所有参数，以下是最实用的命令组合。

### 按 AI 工具查看

ccusage 支持 15+ AI 编程工具，通过子命令指定来源：

| AI 工具 | 命令示例 |
|---------|---------|
| Claude Code | `ccusage-cn claude -b` |
| Codex | `ccusage-cn codex daily` |
| GitHub Copilot | `ccusage-cn copilot daily` |
| Gemini CLI | `ccusage-cn gemini daily` |
| Qwen | `ccusage-cn qwen daily` |
| Kimi | `ccusage-cn kimi daily` |
| Goose | `ccusage-cn goose daily` |
| … 及更多 | `ccusage-cn --help` |

> 使用 `ccusage-cn daily`（不指定子命令）可汇总所有检测到的 AI 工具。

### 你每天都在用的

```bash
# 查看 Claude Code 昨日费用（简要模式）
bunx ccusage-cn@latest claude -b --since $(date -v-1d +%Y%m%d)

# 查看 Claude Code 最近会话区块
bunx ccusage-cn@latest claude blocks --recent

# 查看 Claude Code 当前活跃会话（实时费用）
bunx ccusage-cn@latest claude blocks --active
```

### 时间粒度

```bash
ccusage-cn daily          # 按日汇总（默认）
ccusage-cn weekly         # 按周汇总
ccusage-cn monthly        # 按月汇总
ccusage-cn session        # 按会话汇总
ccusage-cn blocks         # 按 Token 区块明细
```

### 时间过滤

```bash
# 指定日期范围
ccusage-cn claude daily --since 2026-07-01 --until 2026-07-08

# 最近一天（macOS）
ccusage-cn claude -b --since $(date -v-1d +%Y%m%d)

# 最近一天（Linux）
ccusage-cn claude -b --since $(date -d '1 day ago' +%Y%m%d)
```

### 常用标志

```bash
-b, --brief          # 简要模式，适合快速浏览
--json               # JSON 输出（保留 costUSD，追加 costCNY）
--compact            # 紧凑表格，适合截图分享
--breakdown          # 按模型分解费用明细
--no-cost            # 隐藏费用列，仅显示 Token 用量
--instances          # 按项目/实例分组
--offline            # 离线模式，使用预缓存定价数据
```

---

## Claude Code Statusline 集成

将费用信息嵌入 Claude Code 状态栏：

> 参见上游 [ccusage statusline 文档](https://github.com/ccusage/ccusage#statusline-beta) 了解配置方式，将命令中的 `ccusage` 替换为 `ccusage-cn` 即可。

---

## 自定义汇率 / Custom Exchange Rate

```bash
# 使用自定义汇率（覆盖默认值 7.2）
CCUSAGE_CNY_RATE=7.25 ccusage-cn claude -b
```

汇率回退策略（三层）：

1. **环境变量**：`CCUSAGE_CNY_RATE` 显式设置的值优先级最高
2. **CDN 缓存**：首次联网运行时从免费 API 获取实时汇率并缓存到本地（`~/.ccusage-cn/cache/rate.json`）
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

**平台兼容性（CI 验证通过 ✅）：**

| 平台 | Node.js 18 | Node.js 20 | Node.js 22 |
|------|-----------|-----------|-----------|
| macOS（ARM64） | ✅ | ✅ | ✅ |
| Ubuntu（x64） | ✅ | ✅ | ✅ |
| Windows（x64） | ✅ | ✅ | ✅ |

---

## 兼容的上游版本 / Compatible Upstream Version

- **上游依赖**：`ccusage@^20.0.0`（caret 范围，自动兼容 patch 和 minor 更新）
- **ccusage-cn 版本**：`1.0.3`（独立语义化版本，不与上游版本号关联）

上游发布 patch/minor 更新时，用户执行 `bunx ccusage-cn@latest` 即可自动使用兼容的最新版本。上游 CI 每周自动检测兼容性。

---

## 许可 / License

MIT License — 与上游 ccusage 一致。
