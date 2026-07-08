---
slug: daily-exchange-rate
created: 2026-07-08
status: complete
revision: 2
---

# 按日期使用独立汇率 + 表格展示汇率

## 问题

1. **多天数据使用同一汇率**：上游 `--days N` 命令输出跨越多个日期的数据，当前实现对所有日期使用同一个当前汇率进行 USD→CNY 转换，但实际每天的汇率不同
2. **汇率不可见**：用户无法知道转换使用了什么汇率

## 推荐方案

### 汇率展示：底部脚注区（优于增加行/列）

| 方案 | 优点 | 缺点 |
|------|------|------|
| 增加列 | 每行自包含 | 需解析/重构整个表格结构，极易因上游格式变化而崩溃 |
| 增加行 | 较简单 | 打断数据流，Total 行位置变化 |
| **底部脚注** ✅ | 不破坏表格结构，上游兼容性最好，信息同样清晰 | 需眼睛移动到表格下方 |

**JSON 模式**：每个 daily entry 和 modelBreakdown 添加 `exchangeRate` 字段。

### 历史汇率数据源

`@fawazahmed0/currency-api` 支持按日期获取历史汇率：
```
https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{YYYY-MM-DD}/v1/currencies/usd.json
```
免费、无需 API Key、CDN 分发。已验证 HTTP 200 + 正确 CNY 数据。

---

## 实现计划

### Task 1: exchange-rate.js — 支持历史汇率

- 新增 `getExchangeRateForDate(dateStr)` 函数
- **环境变量优先级最高**：函数入口先检查 `CCUSAGE_CNY_RATE`，如设置则所有日期返回该值
- 对"今天"的日期：复用 `getExchangeRate()`（含 24h TTL 缓存 + env var + CDN + 默认值回退）
- 对历史日期：从 CDN 获取，缓存到独立文件 `rate-{YYYY-MM-DD}.json`
- **缓存 TTL 策略**：历史汇率数据不可变，永久缓存（无 TTL）；当前汇率保持 24h TTL
- 回退策略：历史 API 失败（网络错误或 404）→ 降级到当前 `getExchangeRate()` → 硬编码默认值 7.2

### Task 2: output-transform.js — JSON 模式按日期转换

**架构策略：预处理 + 同步转换（不把 addCostCNY 改为异步）**

流程：
1. JSON.parse 整个 buffer → 得到 `{ daily: [...], summary: {...} }`
2. 提取所有唯一的 `period` 值 → `[...new Set(daily.map(e => e.period))]`
3. 并发获取所有历史汇率（自实现并发池，最大并发 ≤ 10，避免 socket 耗尽），见 `utils.js` 新增 `asyncPool(limit, items, fn)`
4. 构建 `period → rate` 映射表
5. 遍历 daily 数组，对每个 entry：
   - 用该 entry 的 `period` 查映射表获取汇率
   - 调用现有的同步 `addCostCNY(entry, rate)` 转换费用字段
   - 为 entry 和其下每个 `modelBreakdowns[]` 添加 `exchangeRate` 字段
6. **summary 级别**：使用 `daily` 数组中**最后一个 entry 的 period** 对应的汇率转换 `totalCostUSD`，并添加 `exchangeRate` 字段
7. JSON.stringify 输出

### Task 3: output-transform.js — 文本模式按日期转换 + 脚注

#### 3a. 缓冲模式优化

并非所有情况都需要缓冲。优化分流逻辑：
- `CCUSAGE_CNY_RATE` 环境变量已设置 → 所有日期统一汇率，直接复用现有流式 `createTextTransform(rate)`（无缓冲）
- `--help` / `-h` → 流式透传（当前逻辑不变）
- 其他情况 → 使用新的 `createBufferedTextTransform(getRateForDate)`

#### 3b. 表格行解析状态机（核心复杂度）

上游表格格式（从 fixture 验证）：
```
│ 2025     │ All        │ ...    $0.00 │    ← 年份行（第二列 = "All"，日期头）
│ 09-22    │            │               │    ← MM-DD 行（第二列空，续上行日期）
├──────────┼────────────┤               │    ← 分隔线
│          │ - Codex    │ ...    $0.00 │    ← agent 行（第一列空，属于上方日期组）
├──────────┼────────────┤               │
│ 2025     │ All        │ ...    $6.11 │    ← 下一个日期组开始
│ 09-29    │            │               │
│ Total    │            │ ...    $6.11 │    ← 汇总行
```

状态机：
```
状态: INIT
  ├─ 遇到 /^│ \d{4} +│/ + 第二列非空 → 捕获年份 YYYY
  │   状态 → GOT_YEAR
  │
  └─ 非日期行 → 累积到 buffer

状态: GOT_YEAR
  └─ 下一行 /^│ \d{2}-\d{2} +│/ + 第二列空 → 组成完整日期 YYYY-MM-DD
      状态 → IN_DATE_GROUP
      获取该日期的汇率，后续 $ 替换使用此汇率

状态: IN_DATE_GROUP
  ├─ 空第一列的行 → 属于当前日期组（保持当前汇率）
  ├─ 新 /^│ \d{4} +│/ + 第二列非空 → 新日期组开始，回到 GOT_YEAR
  ├─ /^│ Total +│/ → 退出日期组，进入 TOTAL
  └─ 文件结束 → DONE

状态: TOTAL
  └─ Total 行的 $ 替换使用**最后一个日期**的汇率
```

**格式探测**：先用单行日期正则 `/│ \d{4}-\d{2}-\d{2} +│/` 匹配，失败再尝试两行格式。都不匹配 → 回退流式 `createTextTransform`，使用当前汇率不显示脚注。

#### 3c. 脚注格式与截断

格式：
```
💱 汇率参考 (CNY/USD):
  2025-09-22: 7.2500
  2025-09-29: 7.2800
```

**截断策略**：当脚注行数 > 20 时：
```
💱 汇率参考 (CNY/USD):
  2025-01-01: 7.2500
  2025-01-02: 7.2800
  2025-01-03: 7.2600
  2025-01-04: 7.2650
  2025-01-05: 7.2700
  ... (360 天，汇率范围 6.7900–7.2800)
  2025-07-06: 6.7900
  2025-07-07: 6.8000
  2025-07-08: 6.7934
```

**API 404 标注**：回退到当前汇率的日期，在脚注中用 `*` 标注：
```
  2025-13-01: 7.2500*  (* 历史汇率不可用，使用当前汇率)
```

#### 3d. ANSI 保留

状态机解析时，先 strip ANSI 做模式匹配，但保留原始 ANSI 内容用于最终输出重建。

### Task 4: cli.js — 接入新流程

```js
async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json') && !args.includes('--help') && !args.includes('-h');
  const isHelp = args.includes('--help') || args.includes('-h');
  const hasEnvRate = !!(process.env.CCUSAGE_CNY_RATE && /^\d+(\.\d+)?$/.test(process.env.CCUSAGE_CNY_RATE));

  const { command, args: cmdArgs } = await resolveBinary(args);

  if (isJson) {
    // JSON 模式：始终需要 getRateForDate 回调
    const rate = await getExchangeRate(); // 当前汇率作为 fallback
    const getRateForDate = (date) => getExchangeRateForDate(date, rate);
    const { child, cleanup } = createSpawner(command, cmdArgs);
    createExitHandler(child, cleanup);
    child.stdout.pipe(createJsonTransform(getRateForDate, rate)).pipe(process.stdout);
  } else if (isHelp || hasEnvRate) {
    // 流式模式（帮助输出或统一汇率）
    const rate = hasEnvRate ? parseFloat(process.env.CCUSAGE_CNY_RATE) : await getExchangeRate();
    const { child, cleanup } = createSpawner(command, cmdArgs);
    createExitHandler(child, cleanup);
    child.stdout.pipe(createTextTransform(rate)).pipe(process.stdout);
  } else {
    // 缓冲模式（多日期文本表格）
    const getRateForDate = (date) => getExchangeRateForDate(date);
    const { child, cleanup } = createSpawner(command, cmdArgs);
    createExitHandler(child, cleanup);
    child.stdout.pipe(createBufferedTextTransform(getRateForDate)).pipe(process.stdout);
  }
}
```

### Task 5: 测试更新

- Task 1 测试：`getExchangeRateForDate` 各层回退（env var > 缓存 > CDN > 默认值）
- Task 1 测试：历史日期缓存无 TTL，今天日期有 24h TTL
- Task 2 测试：多日期 JSON 各 entry 使用不同汇率，exchangeRate 字段存在
- Task 2 测试：summary 使用最后日期汇率
- Task 3 测试：状态机正确解析两行日期格式
- Task 3 测试：单行日期格式探测
- Task 3 测试：多日期文本表格各区域使用不同汇率
- Task 3 测试：脚注输出格式正确
- Task 3 测试：>20 日期时脚注截断
- Task 3 测试：ANSI 保留
- 集成测试：env var 设置时走流式分支

---

## 边界情况

| 场景 | 行为 |
|------|------|
| 上游输出不含日期信息 | 回退到流式 `createTextTransform`，使用当前汇率，不显示脚注 |
| 历史日期 API 404 | 回退到当前 `getExchangeRate()`，脚注中该日期标注 `*` |
| 网络错误（非 404） | 同上 |
| 环境变量 `CCUSAGE_CNY_RATE` | 所有日期统一使用该值，走流式分支（无缓冲延迟） |
| ANSI 颜色码 | 状态机先 strip ANSI 做匹配，保留原始内容用于重建 |
| `--days 365` 并发 | `Promise.all` 并发获取，`p-limit` 控制并发 ≤ 10 |
| `--days 365` 脚注长度 | 脚注 > 20 行时截断（前 5 + ... + 后 3） |
| 未来日期 / 无效格式日期 | API 404 → 回退到当前汇率 |
| Total 行（文本模式） | 使用**最后一个日期组**的汇率 |
| Summary（JSON 模式） | 使用 `daily` 中**最后一个 entry 的 period** 的汇率 |
| 日期格式探测失败 | 全部回退流式，使用当前汇率 |
