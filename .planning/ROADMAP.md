# ccusage-cn 路线图

**创建时间:** 2026-07-08
**粒度:** 粗粒度 (Coarse) — 3 个阶段
**模式:** MVP — 每个阶段交付端到端用户能力

---

## 阶段总览 (Phases)

- [x] **Phase 1: 核心包装器 (MVP)** - 构建零依赖 Node.js CLI 包装器，实现上游进程托管、输出流人民币转换 (completed 2026-07-08)
- [ ] **Phase 2: npm 发布与跨平台支持** - 发布 npm 包，确保 macOS/Linux/Windows 三平台可用
- [ ] **Phase 3: CI 与更新维护** - 建立自动化 CI，定期验证上游兼容性

---

## 阶段详情 (Phase Details)

### Phase 1: 核心包装器 (MVP)

**目标:** 用户可在本地运行 ccusage-cn 替代 ccusage，所有命令参数完全相同，费用自动以人民币显示

**模式:** mvp

**依赖:** 无（起始阶段）

**需求项:** CLI-01, CLI-02, CLI-03, CLI-04, COST-01, COST-02, COST-03, COST-04, OUT-01, OUT-02, OUT-03, DIST-02, UPD-01

**成功标准** (完成时必须为真):

1. 用户执行 `bunx ccusage-cn -b`（或本地等价命令），输出内容与 `bunx ccusage -b` 完全一致，但所有 `$X.XX` 费用值被替换为 `¥Y.YY` 人民币显示
2. 用户执行 `ccusage-cn blocks --active`，看到带 ANSI 彩色的表格输出，费用列以人民币显示且列对齐合理，不因位数变化导致严重错位
3. 用户执行 `ccusage-cn --json`，输出 JSON 结构中保留原始 `costUSD` 字段，并新增 `costCNY` 字段（人民币等值）
4. 用户运行 ccusage-cn 后按 Ctrl+C 中断，上游 ccusage 进程同步终止，退出码正确传播至 Shell，无残留孤儿进程
5. 用户设置 `CCUSAGE_CNY_RATE=7.0` 环境变量后运行，费用转换使用该自定义汇率而非默认值
6. 用户断网环境下运行 ccusage-cn，不因网络请求失败而阻塞，使用默认汇率 7.2 正常输出

**计划:** 2 个计划

**计划清单:**
- [x] `01-01-PLAN.md` — 项目脚手架与核心模块（汇率获取、输出转换）
- [ ] `01-02-PLAN.md` — 二进制解析、进程管理与 CLI 入口集成

---

### Phase 2: npm 发布与跨平台支持

**目标:** ccusage-cn 发布至 npm 公共注册表，macOS/Linux/Windows 三平台用户可通过 `bunx ccusage-cn` 开箱使用

**模式:** mvp

**依赖:** 阶段 1

**需求项:** DIST-01, DIST-03

**成功标准** (完成时必须为真):

1. 用户执行 `bunx ccusage-cn <args>`（macOS），npx/bunx 自动安装并正常运行，费用以人民币显示
2. 用户在 Linux 执行 `npx ccusage-cn <args>`，行为与 macOS 完全一致
3. 用户在 Windows（PowerShell/Git Bash/CMD）执行 `npx ccusage-cn <args>`，行为与 macOS/Linux 完全一致
4. npm 包 `ccusage-cn` 在 npmjs.com 上可搜索、可安装

**计划:** 1 个计划

**计划清单:**
- [ ] `02-01-PLAN.md` — 发布前配置（package.json、publint）、中英双语 README、npm 发布与验证

---

### Phase 3: CI 与更新维护

**目标:** 建立自动化 CI 流水线，定期验证上游兼容性，确保 ccusage-cn 长期可维护且自动继承上游更新

**模式:** mvp

**依赖:** 阶段 2

**需求项:** UPD-02

**成功标准** (完成时必须为真):

1. GitHub Actions CI 在每次代码推送时自动运行集成测试，验证基本功能正常
2. CI 每周定时执行（cron），针对上游 ccusage 最新版本运行兼容性检测，若 major 版本变更破坏兼容性则告警
3. 上游发布 patch/minor 更新时，用户执行 `npm update` 即可安装兼容的最新版本（依赖项版本范围 `^20.0.0`）

**计划:** 待定

---

## 进度表 (Progress)

| 阶段 | 计划完成 | 状态 | 完成日期 |
|------|----------|------|----------|
| 1. 核心包装器 (MVP) | 2/2 | Complete   | 2026-07-08 |
| 2. npm 发布与跨平台支持 | 0/1 | 未开始 | - |
| 3. CI 与更新维护 | 0/0 | 未开始 | - |

## 覆盖验证 (Coverage)

| 需求项 | 阶段 | 状态 |
|--------|------|------|
| CLI-01 | 阶段 1 | ✓ |
| CLI-02 | 阶段 1 | ✓ |
| CLI-03 | 阶段 1 | ✓ |
| CLI-04 | 阶段 1 | ✓ |
| COST-01 | 阶段 1 | ✓ |
| COST-02 | 阶段 1 | ✓ |
| COST-03 | 阶段 1 | ✓ |
| COST-04 | 阶段 1 | ✓ |
| DIST-01 | 阶段 2 | ✓ |
| DIST-02 | 阶段 1 | ✓ |
| DIST-03 | 阶段 2 | ✓ |
| OUT-01 | 阶段 1 | ✓ |
| OUT-02 | 阶段 1 | ✓ |
| OUT-03 | 阶段 1 | ✓ |
| UPD-01 | 阶段 1 | ✓ |
| UPD-02 | 阶段 3 | ✓ |

**总计:** 16/16 v1 需求已映射 ✓
