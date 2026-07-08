// @ts-check
import { Transform } from 'node:stream';
import { asyncPool, formatCNY } from './utils.js';
import { matchCnModel, calcCnCost } from './pricing/cost-calculator.js';

/**
 * 判断字段名是否为费用字段
 *
 * @param {string} key - JSON 字段名
 * @returns {boolean}
 */
function isCostField(key) {
  return /^(cost|totalCost|total_cost|charge|price|fee|spend)/i.test(key);
}

/**
 * 为费用字段生成对应的 CNY 字段名
 * - costUSD → costCNY（去除 USD 后缀）
 * - totalCost → totalCostCNY（直接追加）
 *
 * @param {string} key - 原始字段名
 * @returns {string} CNY 字段名
 */
function cnyFieldName(key) {
  // 如果以 USD 结尾，去掉 USD 再追加 CNY（如 costUSD → costCNY）
  if (/USD$/i.test(key)) {
    return key.slice(0, -3) + 'CNY';
  }
  // 否则直接追加 CNY（如 totalCost → totalCostCNY）
  return key + 'CNY';
}

/**
 * 检测 JSON 字符串使用的缩进空格数
 *
 * @param {string} raw - 原始 JSON 字符串
 * @returns {number}
 */
function detectJsonIndent(raw) {
  const match = raw.match(/\n( +)/);
  return match ? match[1].length : 2;
}

/**
 * 递归遍历对象/数组，为费用字段追加 CNY 等值字段
 *
 * @template T
 * @param {T} obj - 要处理的值
 * @param {number} rate - 汇率
 * @returns {T}
 */
function addCostCNY(obj, rate) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return /** @type {T} */ (obj.map((item) => addCostCNY(item, rate)));
  }
  const result = /** @type {Record<string, unknown>} */ ({ ...obj });
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number' && isCostField(key)) {
      result[cnyFieldName(key)] = parseFloat((value * rate).toFixed(2));
    } else if (typeof value === 'object') {
      result[key] = addCostCNY(value, rate);
    }
  }
  return /** @type {T} */ (result);
}

/**
 * 从 daily 数组中提取所有唯一日期
 *
 * @param {Array<{ period?: string }>} daily - daily 数组
 * @returns {string[]} 去重后的日期列表
 */
function extractPeriods(daily) {
  if (!Array.isArray(daily)) return [];
  /** @type {Set<string>} */
  const periods = new Set();
  for (const entry of daily) {
    if (entry && typeof entry.period === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.period)) {
      periods.add(entry.period);
    }
  }
  return [...periods];
}

/**
 * 按日期汇率转换 JSON 数据
 *
 * 流程：提取 unique periods → 并发获取历史汇率 → 构建映射表 →
 * 按 period 对每个 daily entry 用对应 rate 做 addCostCNY + 注入 exchangeRate
 *
 * @param {*} data - JSON.parse 后的数据
 * @param {(date: string) => Promise<number>} getRateForDate - 按日期获取汇率的回调
 * @param {number} fallbackRate - 降级汇率（当前汇率）
 * @returns {Promise<*>} 转换后的数据
 */
async function transformJsonWithRates(data, getRateForDate, fallbackRate) {
  if (!data || typeof data !== 'object') return data;

  const { daily, summary, ...rest } = data;

  // 无 daily 数组 → 回退到统一汇率转换
  if (!Array.isArray(daily) || daily.length === 0) {
    return addCostCNY(data, fallbackRate);
  }

  // 1. 提取所有唯一 period
  const periods = extractPeriods(daily);

  // 2. 并发获取历史汇率（最大并发 10）
  /** @type {Map<string, number>} */
  const rateMap = new Map();

  if (periods.length > 0) {
    const rates = await asyncPool(10, periods, async (period) => {
      const rate = await getRateForDate(period);
      return { period, rate };
    });

    for (const { period, rate } of rates) {
      rateMap.set(period, rate);
    }
  }

  // 3. 按 period 转换每个 daily entry
  const lastPeriod = periods.length > 0 ? periods[periods.length - 1] : null;
  const lastRate = lastPeriod ? (rateMap.get(lastPeriod) ?? fallbackRate) : fallbackRate;

  const convertedDaily = daily.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;

    const period = (typeof entry.period === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.period))
      ? entry.period
      : null;
    const rate = period ? (rateMap.get(period) ?? fallbackRate) : fallbackRate;

    // 用对应汇率转换 cost 字段
    const converted = /** @type {Record<string, unknown>} */ (addCostCNY(entry, rate));

    // 注入 exchangeRate 字段
    converted.exchangeRate = parseFloat(rate.toFixed(4));

    // 注入 modelBreakdowns 中的 exchangeRate
    if (Array.isArray(converted.modelBreakdowns)) {
      converted.modelBreakdowns = converted.modelBreakdowns.map((/** @type {Record<string, unknown>} */ mb) => {
        if (mb && typeof mb === 'object') {
          return { ...mb, exchangeRate: parseFloat(rate.toFixed(4)) };
        }
        return mb;
      });
    }

    return converted;
  });

  // 4. 转换 summary（使用最后一个日期的汇率）
  let convertedSummary = summary;
  if (summary && typeof summary === 'object') {
    convertedSummary = addCostCNY(summary, lastRate);
    convertedSummary.exchangeRate = parseFloat(lastRate.toFixed(4));
  }

  return { ...rest, daily: convertedDaily, summary: convertedSummary };
}

// ============================================================
// 中国模型直连 CNY 覆盖
// ============================================================

/**
 * 安全获取模型 breakdown 中的 token 数值（支持多字段名变体）
 *
 * @param {Record<string, unknown>} mb - modelBreakdown entry
 * @param {...string} keys - 可能的字段名（按优先级）
 * @returns {number}
 */
function getTokenValue(mb, ...keys) {
  for (const key of keys) {
    if (typeof mb[key] === 'number') return mb[key];
  }
  return 0;
}

/**
 * 在 JSON 模式转换后，覆盖中国模型的 costCNY 为直接人民币计算值
 *
 * 遍历 data.daily[].modelBreakdowns 和 data.summary.modelBreakdowns，
 * 对每个匹配中国模型的 entry，用 calcCnCost 重新计算 costCNY。
 * 记录新旧 costCNY 差值，调整父级 totalCostCNY。
 *
 * @param {*} data - 经过 addCostCNY 处理后的 JSON 数据
 * @param {{ models: Record<string, unknown> } | null | undefined} cnPricing - 中国模型定价
 * @returns {*} 覆盖后的数据
 */
function applyCnModelOverrides(data, cnPricing) {
  if (!data || typeof data !== 'object') return data;
  if (!cnPricing?.models) return data;

  const models = /** @type {Record<string, { input: number; output: number; cacheRead?: number }>} */ (cnPricing.models);

  /**
   * 处理单个 entry 的 modelBreakdowns，返回调整后的 entry 和 totalAdjustment
   *
   * @param {Record<string, unknown>} entry - daily 或 summary entry
   * @returns {{ entry: Record<string, unknown>; adjustment: number }}
   */
  function overrideBreakdowns(entry) {
    if (!entry || typeof entry !== 'object') return { entry, adjustment: 0 };

    const mbs = entry.modelBreakdowns;
    if (!Array.isArray(mbs) || mbs.length === 0) return { entry, adjustment: 0 };

    let totalAdjustment = 0;

    const newMbs = mbs.map((/** @type {Record<string, unknown>} */ mb) => {
      if (!mb || typeof mb !== 'object') return mb;

      const modelName = /** @type {string | undefined} */ (mb.modelName);
      if (!modelName) return mb;

      const matched = matchCnModel(modelName, models);
      if (!matched) return mb;

      const inputTokens = getTokenValue(mb, 'inputTokens', 'input_tokens', 'inputTokenCount');
      const outputTokens = getTokenValue(mb, 'outputTokens', 'output_tokens', 'outputTokenCount');
      const cacheReadTokens = getTokenValue(mb, 'cacheReadTokens', 'cache_read_tokens');

      const oldCostCNY = /** @type {number} */ (mb.costCNY) || 0;
      const newCostCNY = calcCnCost(matched.pricing, inputTokens, outputTokens, cacheReadTokens);

      totalAdjustment += newCostCNY - oldCostCNY;

      return { ...mb, costCNY: newCostCNY };
    });

    let newEntry = { ...entry, modelBreakdowns: newMbs };

    // 调整父级 totalCostCNY
    if (totalAdjustment !== 0 && typeof entry.totalCostCNY === 'number') {
      newEntry.totalCostCNY = formatCNY(/** @type {number} */ (entry.totalCostCNY) + totalAdjustment);
    }

    return { entry: newEntry, adjustment: totalAdjustment };
  }

  // 处理 daily
  if (Array.isArray(data.daily)) {
    const newDaily = data.daily.map((/** @type {unknown} */ entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const { entry: newEntry } = overrideBreakdowns(/** @type {Record<string, unknown>} */ (entry));
      return newEntry;
    });
    data = { ...data, daily: newDaily };
  }

  // 处理 summary
  if (data.summary && typeof data.summary === 'object') {
    const { entry: newSummary } = overrideBreakdowns(/** @type {Record<string, unknown>} */ (data.summary));
    data = { ...data, summary: newSummary };
  }

  return data;
}

/**
 * 创建 JSON 模式的 Transform stream（支持按日期汇率）
 *
 * 收集完整 stdout → JSON.parse → 提取 period → 按日期获取汇率 →
 * 递归查找费用字段 → 追加 CNY 等值 + exchangeRate → 中国模型 costCNY 覆盖 →
 * JSON.stringify 输出。
 *
 * @param {(date: string) => Promise<number>} getRateForDate - 按日期获取汇率的回调
 * @param {number} fallbackRate - 降级汇率（当前汇率，用于无日期的 entry）
 * @param {{ models: Record<string, unknown> } | null | undefined} [cnPricing] - 中国模型人民币定价（用于覆盖中国模型的 costCNY）
 * @returns {import('node:stream').Transform}
 */
export function createJsonTransform(getRateForDate, fallbackRate, cnPricing) {
  /** @type {Buffer[]} */
  const chunks = [];

  return new Transform({
    /**
     * @param {Buffer | string} chunk
     * @param {string} encoding
     * @param {(error?: Error | null, data?: never) => void} callback
     */
    transform(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      callback();
    },

    /**
     * @param {(error?: Error | null) => void} callback
     */
    flush(callback) {
      const raw = Buffer.concat(chunks).toString('utf-8');
      (async () => {
        try {
          const data = JSON.parse(raw);
          const converted = await transformJsonWithRates(data, getRateForDate, fallbackRate);
          const finalData = applyCnModelOverrides(converted, cnPricing);
          const indent = detectJsonIndent(raw);
          this.push(JSON.stringify(finalData, null, indent), 'utf-8');
          callback();
        } catch {
          // JSON 解析失败或汇率转换失败，原样透传（不崩溃）
          this.push(raw, 'utf-8');
          callback();
        }
      })();
    },
  });
}

// ============================================================
// 文本模式（流式，简单场景：统一汇率）
// ============================================================

/**
 * 创建文本模式的 Transform stream（流式，统一汇率）
 *
 * 流式逐块将 $X.XX 替换为 ¥Y.YY，将 Cost (USD) 替换为 Cost (CNY)。
 * 处理 chunk 边界上的不完整 $ 数字。
 *
 * 注意：此函数仅用于简单场景（--help、CCUSAGE_CNY_RATE 已设置）。
 * 多日期场景使用 createBufferedTextTransform。
 *
 * @param {number} rate - USD→CNY 汇率
 * @param {object|null|undefined} [cnPricing] - 中国模型人民币定价数据（仅用于签名一致性）
 *   流式模式下无法使用此参数：streaming transform 逐块输出，无法获取完整表格结构、
 *   模型名称、各列 token 计数等结构化信息。中国模型直接 CNY 计算仅在缓冲文本模式
 *   （createBufferedTextTransform）和 JSON 模式（createJsonTransform）中实现。
 *   流式模式仍统一使用 USD * 汇率方式转换中国模型费用。
 * @returns {import('node:stream').Transform}
 */
export function createTextTransform(rate, cnPricing) {
  // cnPricing 在流式模式中不使用（见上方 JSDoc 说明）
  /** @type {string | null} */
  let remainder = null;

  return new Transform({
    /**
     * @param {Buffer | string} chunk
     * @param {string} encoding
     * @param {(error?: Error | null, data?: never) => void} callback
     */
    transform(chunk, encoding, callback) {
      let text = remainder ? remainder + chunk.toString('utf-8') : chunk.toString('utf-8');
      remainder = null;

      // 处理 chunk 边界上的不完整 $ 数字（Pitfall 4 避免方案）
      const partial = text.match(/\$\d*\.?\d*$/);
      if (partial && partial[0].length > 0 && !/\.\d+$/.test(partial[0])) {
        remainder = partial[0];
        text = text.slice(0, -partial[0].length);
      }

      // USD → CNY（捕获前导空格，保持表格列宽不变）
      text = text.replace(
        /( *)(\x1b\[[\d;]+m)?\$(\d+\.?\d*)/g,
        (match, spaces, ansi, amount) => {
          const cny = (parseFloat(amount) * rate).toFixed(2);
          const newValue = `¥${cny}`;
          const ansiCode = ansi || '';

          const visibleWidth = match.length - ansiCode.length;

          if (spaces.length < 2 && !ansiCode) {
            return spaces + newValue;
          }

          return ansiCode + newValue.padStart(visibleWidth);
        }
      );

      // 替换列标题
      text = text.replace(/Cost \(USD\)/g, 'Cost (CNY)');
      text = text.replace(/\(USD\)/g, '(CNY)');

      this.push(text, 'utf-8');
      callback();
    },

    /**
     * @param {(error?: Error | null) => void} callback
     */
    flush(callback) {
      if (remainder) {
        this.push(remainder, 'utf-8');
      }
      callback();
    },
  });
}

// ============================================================
// 文本模式（缓冲，多日期场景：按日期汇率 + 脚注）
// ============================================================

/**
 * strip ANSI 转义序列，保留纯文本用于模式匹配
 *
 * @param {string} str - 可能包含 ANSI 码的字符串
 * @returns {string} 去除 ANSI 后的纯文本
 */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[\d;]*m/g, '');
}

/**
 * 从缓冲文本中提取日期分组信息
 *
 * 返回 { groups, totalLineIndex }：
 * - groups: [{ date: "YYYY-MM-DD", startLine: number, endLine: number }, ...]
 * - totalLineIndex: Total 行所在行号，-1 表示无 Total 行
 *
 * 格式探测：先尝试单行 YYYY-MM-DD，失败则尝试两行格式。
 *
 * @param {string[]} lines - 按行分割的原始文本（含 ANSI）
 * @returns {{ groups: Array<{ date: string; startLine: number; endLine: number }>; totalLineIndex: number; detected: boolean }}
 */
function parseDateGroups(lines) {
  /** @type {Array<{ date: string; startLine: number; endLine: number }>} */
  const groups = [];
  let totalLineIndex = -1;

  // 先尝试单行日期格式：│ YYYY-MM-DD │
  const singleLinePattern = /^│\s*\d{4}-\d{2}-\d{2}\s*│/;
  let currentDate = null;
  let groupStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const plain = stripAnsi(lines[i]);

    // 检测 Total 行
    if (/^│\s*Total\s*│/.test(plain)) {
      if (currentDate !== null && groupStart >= 0) {
        groups.push({ date: currentDate, startLine: groupStart, endLine: i });
        currentDate = null;
        groupStart = -1;
      }
      totalLineIndex = i;
      continue;
    }

    if (singleLinePattern.test(plain)) {
      // 单行日期格式
      const match = plain.match(/(\d{4}-\d{2}-\d{2})/);
      if (match) {
        if (currentDate !== null && groupStart >= 0) {
          groups.push({ date: currentDate, startLine: groupStart, endLine: i });
        }
        currentDate = match[1];
        groupStart = i;
      }
      continue;
    }

    // 检测两行日期格式的第一行：│ YYYY │ + 第二列非空
    const yearMatch = plain.match(/^│\s*(\d{4})\s*│\s*(\S)/);
    if (yearMatch) {
      const year = yearMatch[1];
      // 看下一行是否是 MM-DD 格式
      if (i + 1 < lines.length) {
        const nextPlain = stripAnsi(lines[i + 1]);
        // │ MM-DD │ (空白列) │ ... — 多列表格，第二列为空说明是日期续行
        const mmddMatch = nextPlain.match(/^│\s*(\d{2}-\d{2})\s*│\s*│/);

        if (mmddMatch) {
          if (currentDate !== null && groupStart >= 0) {
            groups.push({ date: currentDate, startLine: groupStart, endLine: i });
          }
          currentDate = `${year}-${mmddMatch[1]}`;
          groupStart = i; // 从年份行开始
          i++; // 跳过 MM-DD 行（它属于这个日期组）
          continue;
        }
      }
    }
  }

  // 最后一个日期组收尾
  if (currentDate !== null && groupStart >= 0) {
    groups.push({ date: currentDate, startLine: groupStart, endLine: lines.length });
  }

  const detected = groups.length > 0;

  return { groups, totalLineIndex, detected };
}

/**
 * 对单行做 $ → ¥ 替换
 *
 * @param {string} line - 原始行（含 ANSI）
 * @param {number} rate - 该行对应日期的汇率
 * @returns {string} 转换后的行
 */
function transformLineWithRate(line, rate) {
  return line.replace(
    /( *)(\x1b\[[\d;]+m)?\$(\d+\.?\d*)/g,
    (match, spaces, ansi, amount) => {
      const cny = (parseFloat(amount) * rate).toFixed(2);
      const newValue = `¥${cny}`;
      const ansiCode = ansi || '';

      const visibleWidth = match.length - ansiCode.length;

      if (spaces.length < 2 && !ansiCode) {
        return spaces + newValue;
      }

      return ansiCode + newValue.padStart(visibleWidth);
    }
  );
}

/**
 * 生成脚注文本
 *
 * @param {Map<string, number>} rateMap - 日期 → 汇率映射
 * @returns {string} 脚注文本（含前导空行）
 */
function buildFootnote(rateMap) {
  if (rateMap.size === 0) return '';

  const entries = [...rateMap.entries()].sort(); // 按日期排序
  const MAX_DISPLAY = 20;

  /** @type {string[]} */
  const lines = ['', '💱 汇率参考 (CNY/USD):'];

  if (entries.length <= MAX_DISPLAY) {
    for (const [date, rate] of entries) {
      lines.push(`  ${date}: ${rate.toFixed(4)}`);
    }
  } else {
    // 截断：前 5 + ... + 后 3
    for (let i = 0; i < 5 && i < entries.length; i++) {
      lines.push(`  ${entries[i][0]}: ${entries[i][1].toFixed(4)}`);
    }
    const rates = entries.map(([, r]) => r);
    const minRate = Math.min(...rates).toFixed(4);
    const maxRate = Math.max(...rates).toFixed(4);
    lines.push(`  ... (${entries.length - 8} 天，汇率范围 ${minRate}–${maxRate})`);
    for (let i = entries.length - 3; i < entries.length; i++) {
      if (i >= 5) {
        lines.push(`  ${entries[i][0]}: ${entries[i][1].toFixed(4)}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * 从表格列中解析数值（去除逗号千分位）
 *
 * @param {string | undefined} col - 列内容
 * @returns {number | null} 解析后的数值，无效返回 null
 */
function parseNumberColumn(col) {
  if (!col) return null;
  const trimmed = col.trim();
  const num = parseFloat(trimmed.replace(/,/g, ''));
  return isNaN(num) ? null : num;
}

/**
 * 在文本输出中覆盖中国模型行的 cost 值为直接人民币计算
 *
 * 解析方式：按 │ 分割行，从 Models 列匹配 "- modelName"，提取 token 计数。
 * 对匹配中国模型的行，用 calcCnCost 重新计算 cost 并替换。
 * ANSI 颜色码保持完整。
 *
 * @param {string} text - 经过 $→¥ 转换后的文本输出
 * @param {{ models: Record<string, unknown> } | null | undefined} cnPricing - 中国模型定价数据
 * @returns {string} 覆盖后的文本
 */
function overrideCnTextOutput(text, cnPricing) {
  if (!cnPricing?.models) return text;

  const models = /** @type {Record<string, { input: number; output: number; cacheRead?: number }>} */ (cnPricing.models);

  // 文本已按行分割（保留原始 ANSI 码）
  const lines = text.split('\n');

  const resultLines = lines.map((line) => {
    // 用 stripped 版本解析列内容（去掉 ANSI 码不影响 │ 分隔符）
    const stripped = stripAnsi(line);
    const parts = stripped.split('│');

    // 需要至少 10 个部分（9 列 + 前导空）
    if (parts.length < 10) return line;

    // 列 3（index 3）是 Models 列，提取模型名
    const modelCol = (parts[3] || '').trim();
    const modelMatch = modelCol.match(/^-\s+(\S+)/);
    if (!modelMatch) return line;

    const modelName = modelMatch[1];
    const matched = matchCnModel(modelName, models);
    if (!matched) return line;

    // 解析 token 计数列
    const inputTokens = parseNumberColumn(parts[4]);
    const outputTokens = parseNumberColumn(parts[5]);
    if (inputTokens === null || outputTokens === null) return line;

    const cacheReadTokens = parseNumberColumn(parts[7]) || 0;

    const directCost = calcCnCost(matched.pricing, inputTokens, outputTokens, cacheReadTokens);

    // 在原始行（含 ANSI）中替换 cost 值
    // 定位到原始行的 cost 列（同样按 │ 分割）
    const rawParts = line.split('│');
    if (rawParts.length < 10) return line;

    // 列 9 是 Cost 列，替换其中的 ¥X.XX 值
    rawParts[9] = rawParts[9].replace(
      /(\s*)(\x1b\[[\d;]+m)?[$¥]\d+\.?\d*/,
      (match, spaces, ansi, _amount) => {
        const newValue = `¥${directCost.toFixed(2)}`;
        const ansiCode = ansi || '';
        const visibleWidth = match.length - ansiCode.length;
        if (spaces.length < 2 && !ansiCode) {
          return spaces + newValue;
        }
        return ansiCode + newValue.padStart(visibleWidth);
      }
    );

    return rawParts.join('│');
  });

  return resultLines.join('\n');
}

/**
 * 创建文本模式的缓冲 Transform stream（支持按日期汇率）
 *
 * 缓冲全部 stdout → 解析日期组 → 获取各日期汇率 →
 * 按日期组分别替换 $ → ¥ → 追加脚注 → 输出。
 *
 * @param {(date: string) => Promise<number>} getRateForDate - 按日期获取汇率的回调
 * @param {number} fallbackRate - 降级汇率（当前汇率，用于无日期场景的回退）
 * @param {{ models: Record<string, unknown> } | null | undefined} [cnPricing] - 中国模型人民币定价（用于文本模式覆盖中国模型行 cost）
 * @returns {import('node:stream').Transform}
 */
export function createBufferedTextTransform(getRateForDate, fallbackRate = 7.2, cnPricing) {
  /** @type {Buffer[]} */
  const chunks = [];

  return new Transform({
    /**
     * @param {Buffer | string} chunk
     * @param {string} encoding
     * @param {(error?: Error | null, data?: never) => void} callback
     */
    transform(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      callback();
    },

    /**
     * @param {(error?: Error | null) => void} callback
     */
    flush(callback) {
      const raw = Buffer.concat(chunks).toString('utf-8');
      (async () => {
        try {
          // 1. 尝试日期格式探测
          const lines = raw.split('\n');
          const { groups, totalLineIndex, detected } = parseDateGroups(lines);

          if (!detected) {
            // 未检测到日期格式 → 回退到流式（使用当前汇率，无需缓冲）
            // 仍收集完整输出以应用中国模型文本覆盖
            const fallbackTransform = createTextTransform(fallbackRate);
            /** @type {string} */
            let fbText = '';
            fallbackTransform.on('data', (chunk) => { fbText += chunk; });
            fallbackTransform.on('end', () => {
              this.push(overrideCnTextOutput(fbText, cnPricing), 'utf-8');
              callback();
            });
            fallbackTransform.write(raw, 'utf-8');
            fallbackTransform.end();
            return;
          }

          // 2. 并发获取所有日期的历史汇率
          /** @type {Map<string, number>} */
          const rateMap = new Map();
          const uniqueDates = [...new Set(groups.map((g) => g.date))];

          const results = await asyncPool(10, uniqueDates, async (date) => {
            const rate = await getRateForDate(date);
            return { date, rate };
          });

          for (const { date, rate } of results) {
            rateMap.set(date, rate);
          }

          // 3. 按日期组分别替换
          /** @type {string[]} */
          const outputLines = [];
          let lastProcessedLine = 0;

          for (const group of groups) {
            const rate = rateMap.get(group.date) ?? 7.2;

            // 输出 group 之前的行（不转换，如分隔线）
            for (let i = lastProcessedLine; i < group.startLine; i++) {
              outputLines.push(lines[i]);
            }

            // 输出 group 范围内的行（$ → ¥ 转换）
            for (let i = group.startLine; i < group.endLine; i++) {
              outputLines.push(transformLineWithRate(lines[i], rate));
            }

            lastProcessedLine = group.endLine;
          }

          // 4. 处理 Total 行（使用最后一个日期组的汇率）
          if (totalLineIndex >= 0) {
            // 输出从 lastProcessedLine 到 totalLineIndex 的行
            for (let i = lastProcessedLine; i < totalLineIndex; i++) {
              outputLines.push(lines[i]);
            }
            const lastRate = groups.length > 0
              ? (rateMap.get(groups[groups.length - 1].date) ?? 7.2)
              : 7.2;
            outputLines.push(transformLineWithRate(lines[totalLineIndex], lastRate));
            lastProcessedLine = totalLineIndex + 1;
          }

          // 输出剩余行
          for (let i = lastProcessedLine; i < lines.length; i++) {
            outputLines.push(lines[i]);
          }

          // 5. 替换列标题
          let output = outputLines.join('\n');
          output = output.replace(/Cost \(USD\)/g, 'Cost (CNY)');
          output = output.replace(/\(USD\)/g, '(CNY)');

          // 6. 中国模型文本覆盖（在标准 $→¥ 转换后，进一步优化中国模型行）
          output = overrideCnTextOutput(output, cnPricing);

          // 7. 追加脚注
          output += buildFootnote(rateMap);

          this.push(output, 'utf-8');
          callback();
        } catch {
          // 出错时原样透传
          this.push(raw, 'utf-8');
          callback();
        }
      })();
    },
  });
}
