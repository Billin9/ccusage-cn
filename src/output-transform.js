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

  // 处理 blocks（与 daily/session 结构不同：使用 tokenCounts + models[] 而非 modelBreakdowns[]）
  if (Array.isArray(data.blocks)) {
    const newBlocks = data.blocks.map((/** @type {unknown} */ block) => {
      if (!block || typeof block !== 'object') return block;
      const b = /** @type {Record<string, unknown>} */ (block);

      // 跳过 gap / inactive blocks
      if (b.isGap) return block;

      const blockModels = /** @type {string[]} */ (b.models) || [];
      const tokenCounts = /** @type {Record<string, number> | undefined} */ (b.tokenCounts);

      if (!tokenCounts || blockModels.length === 0) return block;

      // 对单模型 block，直接计算中国模型费用
      if (blockModels.length === 1) {
        const modelName = blockModels[0];
        const matched = matchCnModel(modelName, models);
        if (matched) {
          const inputTokens = tokenCounts.inputTokens || 0;
          const outputTokens = tokenCounts.outputTokens || 0;
          const cacheReadTokens = tokenCounts.cacheReadInputTokens || 0;
          const newCostCNY = calcCnCost(matched.pricing, inputTokens, outputTokens, cacheReadTokens);
          return { ...b, costCNY: newCostCNY };
        }
      }

      // 多模型 block 无法拆分 per-model token，保持现有 costCNY
      return block;
    });
    data = { ...data, blocks: newBlocks };
  }

  // 处理 sessions（结构类似 daily，但用 sessions 数组）
  if (Array.isArray(data.sessions)) {
    const newSessions = data.sessions.map((/** @type {unknown} */ entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const { entry: newEntry } = overrideBreakdowns(/** @type {Record<string, unknown>} */ (entry));
      return newEntry;
    });
    data = { ...data, sessions: newSessions };
  }

  // 处理 months（结构类似 daily，但用 months 数组）
  if (Array.isArray(data.months)) {
    const newMonths = data.months.map((/** @type {unknown} */ entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const { entry: newEntry } = overrideBreakdowns(/** @type {Record<string, unknown>} */ (entry));
      return newEntry;
    });
    data = { ...data, months: newMonths };
  }

  // 处理 weeks（结构类似 daily，但用 weeks 数组）
  if (Array.isArray(data.weeks)) {
    const newWeeks = data.weeks.map((/** @type {unknown} */ entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const { entry: newEntry } = overrideBreakdowns(/** @type {Record<string, unknown>} */ (entry));
      return newEntry;
    });
    data = { ...data, weeks: newWeeks };
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
/**
 * 从行中提取费用数值
 *
 * @param {string} line - 表格行（含 ANSI）
 * @param {number} costIdx - Cost 列索引
 * @returns {number} 提取的费用值，解析失败返回 0
 */
function extractCostFromLine(line, costIdx) {
  const rawParts = line.split('│');
  if (rawParts.length <= costIdx) return 0;
  const stripped = stripAnsi(rawParts[costIdx]);
  const match = stripped.match(/[¥$](\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * 更新行中 Cost 列的值为指定金额
 *
 * @param {string} line - 原始行（含 ANSI）
 * @param {number} costIdx - Cost 列索引
 * @param {number} newCost - 新的费用值
 * @returns {string} 更新后的行
 */
function updateLineCost(line, costIdx, newCost) {
  const rawParts = line.split('│');
  if (rawParts.length <= costIdx) return line;
  rawParts[costIdx] = rawParts[costIdx].replace(
    /(\s*)(\x1b\[[\d;]+m)?[$¥]\d+\.?\d*/,
    (match, spaces, ansi) => {
      const ansiCode = ansi || '';
      const newValue = `¥${newCost.toFixed(2)}`;
      const visibleWidth = match.length - ansiCode.length;
      if (spaces.length < 2 && !ansiCode) {
        return spaces + newValue;
      }
      return ansiCode + newValue.padStart(visibleWidth);
    }
  );
  return rawParts.join('│');
}

/**
 * 检测是否为 blocks 格式的表格输出
 *
 * blocks 格式特征：
 * - 表头含 "Block Start" 和 "Duration"
 * - 6 列格式：Block Start | Duration/Status | Models | Tokens | % | Cost
 *
 * @param {string} text - 输出文本
 * @returns {boolean}
 */
function isBlocksFormat(text) {
  return /Block Start/.test(text) && /Duration/.test(text);
}

/**
 * 处理 blocks 格式文本的中国模型费用覆盖
 *
 * blocks 是 6 列格式：Block Start | Duration/Status | Models | Tokens | % | Cost
 * 与 daily/session 的 8-10 列格式完全不同。
 *
 * 策略：
 * - 单模型 block + 中国模型 → 直接 CNY 计算（用 totalTokens 按输入价估算）
 * - 多模型 block → 无法从文本中获取 per-model token 分解，保持原有费用
 * - gap/inactive/projection 行 → 跳过
 *
 * @param {string} text - 经过 $→¥ 转换后的文本输出
 * @param {Record<string, { input: number; output: number; cacheRead?: number }>} models - 中国模型定价
 * @returns {string} 覆盖后的文本
 */
function overrideBlocksTextOutput(text, models) {
  const rawLines = text.split('\n');

  // =========================================================
  // Phase 1：合并模型列换行
  // =========================================================
  // blocks 中多模型时，第一行 "- " 截断，后续行是模型名续行：
  //   Line N:   │ ... │              │ -                │ ...
  //   Line N+1: │ ... │              │ deepseek-v4-pro  │ ...
  //   Line N+2: │ ... │              │ - glm-5.2        │ ...
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const stripped = stripAnsi(rawLines[i]);
    const parts = stripped.split('│');

    // blocks 有 6 列 → 8 parts（含首尾空 parts）
    if (parts.length >= 7) {
      const modelCol = (parts[3] || '').trim();
      const tokensCol = (parts[4] || '').trim();

      // 检测截断的 "- "（只有 dash，后面无模型名）且有 token 数据（说明这是主行）
      if (/^-\s*$/.test(modelCol) && tokensCol && tokensCol !== '-') {
        // 收集后续行中的模型名
        /** @type {string[]} */
        const modelNames = [];
        let j = i + 1;
        while (j < rawLines.length) {
          const nextStripped = stripAnsi(rawLines[j]);
          const nextParts = nextStripped.split('│');
          if (nextParts.length < 7) break;

          const nextFirstCol = (nextParts[1] || '').trim();
          const nextModelCol = (nextParts[3] || '').trim();
          const nextTokensCol = (nextParts[4] || '').trim();

          // 如果下一行有自己的 token 数据或第一列非空 → 不是续行
          if (nextFirstCol || (nextTokensCol && nextTokensCol !== '-')) break;

          if (!nextModelCol) break;

          // 检测模型名（可能带 "- " 前缀，也可能是纯续行）
          const nameMatch = nextModelCol.match(/^-\s+(.+)/);
          if (nameMatch) {
            modelNames.push(nameMatch[1]);
          } else if (nextModelCol && !/^[┌┐├┤└┘┴┬┼─═]/.test(nextModelCol) && !/^-\s*$/.test(nextModelCol)) {
            // 纯模型名续行（无前导 "-"），排除空的 "- " 占位行
            modelNames.push(nextModelCol);
          } else {
            break;
          }
          j++;
        }

        if (modelNames.length > 0) {
          // 重建模型列：用第一个模型名替换截断的 "- "
          const rawParts = rawLines[i].split('│');
          const firstModel = modelNames[0];
          const restModels = modelNames.slice(1);
          rawParts[3] = rawParts[3].replace(/-\s*$/, `- ${firstModel}`);
          // 追加其余模型名
          if (restModels.length > 0) {
            rawParts[3] = rawParts[3].trimEnd() + ', ' + restModels.join(', ');
          }
          lines.push(rawParts.join('│'));
          i = j - 1; // 跳过已合并的行
          continue;
        }
      }
    }
    lines.push(rawLines[i]);
  }

  // =========================================================
  // Phase 2：逐行处理，对中国模型单模型 block 做直接 CNY 计算
  // =========================================================
  const resultLines = [];
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripAnsi(lines[i]);
    const parts = stripped.split('│');

    if (parts.length < 7) {
      resultLines.push(lines[i]);
      continue;
    }

    const firstCol = (parts[1] || '').trim();
    const statusCol = (parts[2] || '').trim();
    const modelCol = (parts[3] || '').trim();
    const tokensCol = (parts[4] || '').trim();

    // 跳过分隔线和非数据行
    if (!firstCol || /^[┌┐├┤└┘┴┬┼─═╭╮╰╯]/.test(firstCol)) {
      resultLines.push(lines[i]);
      continue;
    }

    // 跳过 gap / inactive 行（tokens 为 "-"）
    if (tokensCol === '-') {
      resultLines.push(lines[i]);
      continue;
    }

    // 跳过 REMAINING / PROJECTED 行
    if (statusCol === 'REMAINING' || statusCol === 'PROJECTED') {
      resultLines.push(lines[i]);
      continue;
    }

    // 从模型列提取模型名：只支持单模型（如 "- glm-5.2"）
    const modelMatch = modelCol.match(/^-\s+(\S+)/);
    if (!modelMatch) {
      resultLines.push(lines[i]);
      continue;
    }

    // 检查是否包含多个模型（含逗号分隔）
    if (modelCol.includes(',')) {
      // 多模型 block，无法从文本拆分 per-model token → 保持原值
      resultLines.push(lines[i]);
      continue;
    }

    // 宽终端下，多模型 block 的模型名不换行而是分布在后续行
    // 检查下一行是否为模型续行（第一列为空、Models 列有 "- modelName"、无 token 数据）
    if (i + 1 < lines.length) {
      const nextStripped = stripAnsi(lines[i + 1]);
      const nextParts = nextStripped.split('│');
      if (nextParts.length >= 7) {
        const nextFirstCol = (nextParts[1] || '').trim();
        const nextModelCol = (nextParts[3] || '').trim();
        const nextTokensCol = (nextParts[4] || '').trim();
        // 下一行是模型续行：第一列为空、模型列非空且以 "- " 开头、无 token
        if (!nextFirstCol && nextModelCol && /^-\s+/.test(nextModelCol)
            && (!nextTokensCol || nextTokensCol === '')) {
          // 多模型 block → 保持原值
          resultLines.push(lines[i]);
          continue;
        }
      }
    }

    const modelName = modelMatch[1];
    const matched = matchCnModel(modelName, models);
    if (!matched) {
      resultLines.push(lines[i]);
      continue;
    }

    // 提取 token 总数
    const totalTokens = parseNumberColumn(tokensCol);
    if (totalTokens === null) {
      resultLines.push(lines[i]);
      continue;
    }

    // blocks 文本模式只有 totalTokens，无 input/output/cacheRead 分解
    // 典型 Claude Code 使用模式：~80% cacheRead + ~15% input + ~5% output
    // 使用此估算比例计算费用，提供合理近似值
    const estInput = Math.round(totalTokens * 0.15);
    const estOutput = Math.round(totalTokens * 0.05);
    const estCacheRead = Math.round(totalTokens * 0.80);

    const directCost = calcCnCost(matched.pricing, estInput, estOutput, estCacheRead);
    // blocks 的 Cost 列在 parts[6]
    resultLines.push(updateLineCost(lines[i], 6, directCost));
  }

  return resultLines.join('\n');
}

function overrideCnTextOutput(text, cnPricing) {
  if (!cnPricing?.models) return text;

  const models = /** @type {Record<string, { input: number; output: number; cacheRead?: number }>} */ (cnPricing.models);

  // 检测 blocks 格式（6 列表格），走专用处理路径
  if (isBlocksFormat(text)) {
    return overrideBlocksTextOutput(text, models);
  }

  // 检测 compact 格式（5-6 列，无 Cache/Total Tokens 列）
  // compact 表头特征：有 "Cost" 和 "Models" 但无 "Cache" 和 "Total Tokens"
  const isCompact = (() => {
    for (const line of text.split('\n')) {
      const plain = stripAnsi(line);
      if (/Cost/.test(plain) && /Models/.test(plain)) {
        return !/Cache/.test(plain) && !/Total Tokens/.test(plain);
      }
    }
    return false;
  })();

  // compact 格式使用不同的列索引和最小 parts 数
  const MIN_PARTS = isCompact ? 7 : 10;

  // 文本已按行分割（保留原始 ANSI 码）
  const rawLines = text.split('\n');

  // =========================================================
  // Phase 1：合并在终端窗口中换行的子行
  // =========================================================
  // 当模型名太长时，上游 CLI 会将 └─ modelName 拆成两行：
  //   Line N:   │  └─                 │  (token数据) ...
  //   Line N+1: │ deepseek-v4-flash   │  (空) ...
  // 合并后：│  └─ deepseek-v4-flash │ (token数据) ...
  //
  // 同样处理组头模型列表换行：
  //   Line N:   │ 2026-07  │ -                 │ 27,499,186 │ ...
  //   Line N+1: │          │ deepseek-v4-flash │            │ ...
  //   Line N+2: │          │ - deepseek-v4-pro │            │ ...
  // 合并后：│ 2026-07  │ - deepseek-v4-flash, - deepseek-v4-pro │ 27,499,186 │ ...
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const stripped = stripAnsi(rawLines[i]);
    const parts = stripped.split('│');

    // --- 处理 └─ 子行换行（在 Date/Session 列） ---
    if (parts.length >= MIN_PARTS && i + 1 < rawLines.length) {
      const dateCol = (parts[1] || '').trim();
      const truncatedMatch = dateCol.match(/^└─\s*(\S*)$/);
      if (truncatedMatch) {
        const capturedName = truncatedMatch[1];
        if (!capturedName || capturedName.length <= 3) {
          const nextStripped = stripAnsi(rawLines[i + 1]);
          const nextParts = nextStripped.split('│');
          if (nextParts.length >= 2) {
            const nextDateCol = (nextParts[1] || '').trim();
            if (nextDateCol && !/^[└├─┌┐┘┴┬┼]/.test(nextDateCol) && /^\S/.test(nextDateCol)) {
              const rawParts = rawLines[i].split('│');
              const fullName = capturedName ? (capturedName + nextDateCol) : nextDateCol;
              rawParts[1] = rawParts[1].replace(/└─\s*\S*/, `└─ ${fullName}`);
              lines.push(rawParts.join('│'));
              i++;
              continue;
            }
          }
        }
      }
    }

    // --- 处理组头模型列表换行（在 Models 列） ---
    // 模式：组头行 Models 列为 "- " 截断（或 "- modelName" 后跟续行），
    // 后续行第一列为空、Models 列有内容
    if (parts.length >= MIN_PARTS && i + 1 < rawLines.length) {
      const firstCol = (parts[1] || '').trim();
      const modelCol = (parts[2] || '').trim();

      // 检测 Model 列是否有截断的 "- "（只有 dash space，后面无完整模型名）
      const isTruncatedDash = /^-\s*$/.test(modelCol) || /^-\s+\S+$/.test(modelCol);

      // 也检查 parts[3]（10 列 Agent 视图的 Models 列）
      const modelCol3 = parts.length >= 12 ? (parts[3] || '').trim() : '';
      const isTruncatedDash3 = /^-\s*$/.test(modelCol3) || /^-\s+\S+$/.test(modelCol3);

      if (firstCol && !/^[┌┐├┤└┘┴┬┼─═╭╮╰╯]/.test(firstCol) && firstCol !== 'Total'
          && (isTruncatedDash || isTruncatedDash3)) {
        // 收集后续行中的模型名
        /** @type {string[]} */
        const extraModels = [];
        const activeModelCol = isTruncatedDash3 ? 3 : 2;
        let j = i + 1;
        while (j < rawLines.length) {
          const nextStripped = stripAnsi(rawLines[j]);
          const nextParts = nextStripped.split('│');
          if (nextParts.length < 10) break;

          const nextFirstCol = (nextParts[1] || '').trim();
          const nextModelCol = (nextParts[activeModelCol] || '').trim();
          // 检查下一行的 Input 列是否有数据（有数据说明是新组头）
          const inputCol = activeModelCol + 1;
          const nextInput = (nextParts[inputCol] || '').trim();

          // 如果下一行第一列非空或有 token 数据 → 不是续行
          if (nextFirstCol || nextInput) break;

          // 提取模型名
          const nameMatch = nextModelCol.match(/^-\s+(.+)/);
          if (nameMatch) {
            extraModels.push(nameMatch[1]);
          } else if (nextModelCol && !/^[┌┐├┤└┘┴┬┼─═]/.test(nextModelCol) && /^\S/.test(nextModelCol) && !/^-\s*$/.test(nextModelCol)) {
            // 纯模型名续行（无前导 "-"），追加到上一个模型，排除空的 "- " 占位行
            if (extraModels.length > 0) {
              extraModels[extraModels.length - 1] += nextModelCol;
            }
          } else {
            break;
          }
          j++;
        }

        if (extraModels.length > 0) {
          const rawParts = rawLines[i].split('│');
          // 替换截断的 "- " 为完整模型列表
          const allModels = extraModels.map(m => `- ${m}`).join(', ');
          rawParts[activeModelCol] = rawParts[activeModelCol].replace(/-\s*\S*$/, allModels);
          lines.push(rawParts.join('│'));
          i = j - 1; // 跳过已合并的行
          continue;
        }
      }
    }

    lines.push(rawLines[i]);
  }

  // =========================================================
  // Phase 2：逐行处理，收集子行费用并按组汇总
  //
  // 兼容三种表格格式（自动根据列数检测）：
  //   8 列（daily）：  Date | Models | Input | Output | Cache Create | Cache Read | Total Tokens | Cost
  //   9 列（session）：Session | Models | Input | Output | Cache Create | Cache Read | Total Tokens | Cost | Last Activity
  //   10 列（agent）：  Date | Agent | Models | Input | Output | Cache Create | Cache Read | Total Tokens | Cost
  // =========================================================

  /**
   * 检测行是否为组头（日期汇总行 / session 汇总行）
   * 组头特征：非子行、非 Total、有模型列表且有 token 数据
   *
   * @param {string[]} parts - 已按 │ 分割的行
   * @param {number} modelListCol - 模型列表所在列索引
   * @returns {boolean}
   */
  function isGroupHeader(parts, modelListCol) {
    const firstCol = (parts[1] || '').trim();
    // 排除子行、Total、空行、分隔线
    if (!firstCol || firstCol === 'Total' || /^└─/.test(firstCol)) return false;
    if (/^[┌┐├┤└┘┴┬┼─═╭╮╰╯]/.test(firstCol)) return false;
    // 必须有模型列表（"- " 或 " - " 开头，模型名可能在后续行换行）
    const modelCol = (parts[modelListCol] || '').trim();
    if (!/^-/.test(modelCol)) return false;
    // 必须有 token 数据（Input 列非空）
    const inputCol = modelListCol + 1; // Input 紧跟在 Models 后面
    const inputVal = parseNumberColumn(parts[inputCol]);
    return inputVal !== null;
  }

  // 根据列数和内容模式自动检测表格格式
  // 三种格式的模型列表位置不同：8/9 列在 parts[2]，10 列在 parts[3]
  let maxParts = 10;
  /** @type {number} */
  let modelListCol = 2;
  for (const line of lines) {
    const stripped = stripAnsi(line);
    const parts = stripped.split('│');
    if (parts.length > maxParts) maxParts = parts.length;
    // 检测模型列表位置：含 "- modelName" 模式的列
    if (parts.length >= 4 && /^[\s-]+\S/.test((parts[3] || ''))) {
      const col3 = (parts[3] || '').trim();
      const col2 = (parts[2] || '').trim();
      // 如果 parts[3] 有 "- modelName" 且 parts[2] 没有 → 10 列 Agent 视图
      if (/^-\s+\S/.test(col3) && !/^-\s+\S/.test(col2)) {
        modelListCol = 3;
      }
    }
  }

  /** @type {number} costIdx, subInputIdx, subOutputIdx, subCacheReadIdx, subCostIdx */
  let costIdx, subInputIdx, subOutputIdx, subCacheReadIdx, subCostIdx;

  if (isCompact) {
    // compact 模式：5-6 列，无 Cache/Total Tokens 列
    // daily:  Date | Models | Input | Output | Cost (CNY)
    // session: Session | Models | Input | Output | Cost (CNY) | Last Activity
    modelListCol = 2;
    costIdx = 5;
    subInputIdx = 3;
    subOutputIdx = 4;
    subCacheReadIdx = -1; // compact 模式无 Cache Read 列，统一用 0
    subCostIdx = 5;
  } else if (modelListCol === 3) {
    // 10 列：Agent 视图（Date | Agent | Models | Input | Output | Cache Create | Cache Read | Total Tokens | Cost）
    costIdx = 9;
    subInputIdx = 4;
    subOutputIdx = 5;
    subCacheReadIdx = 7;
    subCostIdx = 9;
  } else {
    // 8 或 9 列：daily / session 模式（Models 在 parts[2]）
    costIdx = 8;
    subInputIdx = 3;
    subOutputIdx = 4;
    subCacheReadIdx = 6;
    subCostIdx = 8;
  }

  /** @type {Array<{ idx: number; costSum: number }>} */
  const groupSummaries = [];
  /** @type {number[]} */
  let currentGroupCosts = [];
  let totalLineIdx = -1;
  /** @type {string[]} */
  const resultLines = [];

  for (let i = 0; i < lines.length; i++) {
    const stripped = stripAnsi(lines[i]);
    const parts = stripped.split('│');

    if (parts.length < MIN_PARTS) {
      resultLines.push(lines[i]);
      continue;
    }

    const firstCol = (parts[1] || '').trim();

    // --- 组头（日期汇总行 / session 汇总行）---
    if (isGroupHeader(parts, modelListCol)) {
      // 结算上一个组
      if (groupSummaries.length > 0 && currentGroupCosts.length > 0) {
        const prev = groupSummaries[groupSummaries.length - 1];
        prev.costSum = currentGroupCosts.reduce((a, b) => a + b, 0);
      }
      groupSummaries.push({ idx: resultLines.length, costSum: 0 });
      currentGroupCosts = [];

      // 检查是否为单模型组头（无 -b 模式）：
      // Models 列只有单个 "- modelName"（不含逗号，不含多个模型）
      // 这种行既是组头也是数据行，需要直接在此计算中国模型费用
      //
      // 重要：需要区分无 -b（单模型=组头+数据行合一）和 -b 模式（组头有 token 但后面有 └─ 子行）
      // 判断方法：看后面是否有 └─ 子行，有则是 -b 模式，不要内联处理
      const groupModelCol = (parts[modelListCol] || '').trim();
      const singleModelMatch = groupModelCol.match(/^-\s+(\S+)$/);
      if (singleModelMatch) {
        // 检查后续行是否为 └─ 子行（-b 模式标志）
        let hasBreakdownRows = false;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const aheadStripped = stripAnsi(lines[j]);
          const aheadParts = aheadStripped.split('│');
          if (aheadParts.length >= MIN_PARTS) {
            const aheadFirstCol = (aheadParts[1] || '').trim();
            if (/^└─/.test(aheadFirstCol)) {
              hasBreakdownRows = true;
              break;
            }
            // 遇到下一个组头或 Total 行就停止搜索
            if (aheadFirstCol && aheadFirstCol !== 'Total' && !/^[┌┐├┤└┘┴┬┼─═╭╮╰╯]/.test(aheadFirstCol)) {
              break;
            }
          }
        }

        if (!hasBreakdownRows) {
          const modelName = singleModelMatch[1];
          const matched = matchCnModel(modelName, models);
          if (matched) {
            const inputTokens = parseNumberColumn(parts[modelListCol + 1]);
            const outputTokens = parseNumberColumn(parts[modelListCol + 2]);
            if (inputTokens !== null && outputTokens !== null) {
              const cacheReadCol = modelListCol + 4;
              const cacheReadTokens = parseNumberColumn(parts[cacheReadCol]) || 0;
              const directCost = calcCnCost(matched.pricing, inputTokens, outputTokens, cacheReadTokens);
              currentGroupCosts.push(directCost);
              resultLines.push(updateLineCost(lines[i], costIdx, directCost));
              continue;
            }
          } else {
            // 非中国模型：从已有费用中提取
            const existingCost = extractCostFromLine(lines[i], costIdx);
            if (existingCost > 0) {
              currentGroupCosts.push(existingCost);
            }
          }
        }
      }

      resultLines.push(lines[i]);
      continue;
    }

    // --- Total 行 ---
    if (firstCol === 'Total') {
      if (groupSummaries.length > 0 && currentGroupCosts.length > 0) {
        const prev = groupSummaries[groupSummaries.length - 1];
        prev.costSum = currentGroupCosts.reduce((a, b) => a + b, 0);
      }
      totalLineIdx = resultLines.length;
      resultLines.push(lines[i]);
      continue;
    }

    // --- 子行：格式A（└─ 在 Date/Session 列）---
    const subMatch = firstCol.match(/^└─\s+(\S+)/);
    if (subMatch) {
      const modelName = subMatch[1];
      const matched = matchCnModel(modelName, models);

      if (matched) {
        const inputTokens = parseNumberColumn(parts[subInputIdx]);
        const outputTokens = parseNumberColumn(parts[subOutputIdx]);
        if (inputTokens !== null && outputTokens !== null) {
          const cacheReadTokens = parseNumberColumn(parts[subCacheReadIdx]) || 0;
          const directCost = calcCnCost(matched.pricing, inputTokens, outputTokens, cacheReadTokens);
          currentGroupCosts.push(directCost);
          resultLines.push(updateLineCost(lines[i], subCostIdx, directCost));
          continue;
        }
      } else {
        // 非中国模型：提取已有费用
        const existingCost = extractCostFromLine(lines[i], subCostIdx);
        if (existingCost > 0) {
          currentGroupCosts.push(existingCost);
        }
        resultLines.push(lines[i]);
        continue;
      }
    }

    // --- 子行：格式B（- modelName 在 Models 列，Agent 视图）---
    const modelCol = (parts[modelListCol] || '').trim();
    const mainMatch = modelCol.match(/^-\s+(\S+)/);
    if (mainMatch) {
      const modelName = mainMatch[1];
      const matched = matchCnModel(modelName, models);

      if (matched) {
        const inputTokens = parseNumberColumn(parts[modelListCol + 1]); // Input follows Models
        const outputTokens = parseNumberColumn(parts[modelListCol + 2]); // Output follows Input
        if (inputTokens !== null && outputTokens !== null) {
          // Cache Read 的偏移取决于列数
          const cacheReadCol = modelListCol + 4; // Models+Input+Output+CacheCreate → +4
          const cacheReadTokens = parseNumberColumn(parts[cacheReadCol]) || 0;
          const directCost = calcCnCost(matched.pricing, inputTokens, outputTokens, cacheReadTokens);
          currentGroupCosts.push(directCost);
          resultLines.push(updateLineCost(lines[i], costIdx, directCost));
          continue;
        }
      }
    }

    // 非数据行（分隔线等），直接透传
    resultLines.push(lines[i]);
  }

  // 结算最后一个组
  if (groupSummaries.length > 0 && currentGroupCosts.length > 0) {
    const last = groupSummaries[groupSummaries.length - 1];
    last.costSum = currentGroupCosts.reduce((a, b) => a + b, 0);
  }

  // =========================================================
  // Phase 3：回填组头行和 Total 行的费用
  // =========================================================
  for (const { idx, costSum } of groupSummaries) {
    if (costSum > 0) {
      resultLines[idx] = updateLineCost(resultLines[idx], costIdx, costSum);
    }
  }

  if (totalLineIdx >= 0) {
    const grandTotal = groupSummaries.reduce((s, d) => s + d.costSum, 0);
    if (grandTotal > 0) {
      resultLines[totalLineIdx] = updateLineCost(resultLines[totalLineIdx], costIdx, grandTotal);
    }
  }

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
