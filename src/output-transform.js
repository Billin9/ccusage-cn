// @ts-check
import { Transform } from 'node:stream';
import { asyncPool } from './utils.js';

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

/**
 * 创建 JSON 模式的 Transform stream（支持按日期汇率）
 *
 * 收集完整 stdout → JSON.parse → 提取 period → 按日期获取汇率 →
 * 递归查找费用字段 → 追加 CNY 等值 + exchangeRate → JSON.stringify 输出。
 *
 * @param {(date: string) => Promise<number>} getRateForDate - 按日期获取汇率的回调
 * @param {number} fallbackRate - 降级汇率（当前汇率，用于无日期的 entry）
 * @returns {import('node:stream').Transform}
 */
export function createJsonTransform(getRateForDate, fallbackRate) {
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
          const indent = detectJsonIndent(raw);
          this.push(JSON.stringify(converted, null, indent), 'utf-8');
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
 * @returns {import('node:stream').Transform}
 */
export function createTextTransform(rate) {
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
 * 创建文本模式的缓冲 Transform stream（支持按日期汇率）
 *
 * 缓冲全部 stdout → 解析日期组 → 获取各日期汇率 →
 * 按日期组分别替换 $ → ¥ → 追加脚注 → 输出。
 *
 * @param {(date: string) => Promise<number>} getRateForDate - 按日期获取汇率的回调
 * @param {number} fallbackRate - 降级汇率（当前汇率，用于无日期场景的回退）
 * @returns {import('node:stream').Transform}
 */
export function createBufferedTextTransform(getRateForDate, fallbackRate = 7.2) {
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
            const fallbackTransform = createTextTransform(fallbackRate);
            fallbackTransform.on('data', (chunk) => this.push(chunk));
            fallbackTransform.on('end', () => callback());
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

          // 6. 追加脚注
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
