---
status: complete
completed_at: 2026-07-08T20:31:00+08:00
---

# 按日期使用独立汇率 + 表格展示汇率

## 完成内容

### Task 1: exchange-rate.js — 支持历史汇率
- 新增 `getExchangeRateForDate(dateStr, fallbackRate)` 函数
- 优先级：CCUSAGE_CNY_RATE env var → 今天复用 getExchangeRate() → 历史缓存 → CDN API → 降级 → 7.2
- 历史汇率永久缓存（无 TTL），当前汇率 24h TTL
- utils.js 新增 `asyncPool(concurrency, items, fn)` 并发池

### Task 2: JSON 模式按日期转换
- `createJsonTransform(getRateForDate, fallbackRate)` — 新签名
- 提取 unique periods → asyncPool(10) 并发获取汇率 → 构建 rateMap
- 每个 daily entry 使用对应 period 的汇率
- 注入 exchangeRate 字段到 entry、modelBreakdowns、summary

### Task 3: 文本模式缓冲 + 脚注
- 新增 `createBufferedTextTransform(getRateForDate, fallbackRate)`
- 日期解析：单行 `YYYY-MM-DD` 格式 + 两行 `YYYY / MM-DD` 格式自动探测
- 脚注格式 + >20 日期截断

### Task 4: cli.js 接入
- JSON 模式 → createJsonTransform
- Help/EnvRate → createTextTransform（流式）
- 其他 → createBufferedTextTransform（缓冲）

### Task 5: 测试
- 36 个测试全部通过
- 覆盖：多日期 JSON、多日期文本、单行/两行日期格式、ANSI 保留、脚注截断

## 已知限制
- 脚注中未实现回退汇率的 `*` 标注（极边缘场景，后续迭代）
