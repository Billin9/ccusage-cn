// @ts-check
import { Transform } from 'node:stream';

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
 * 创建文本模式的 Transform stream
 *
 * 流式逐块将 $X.XX 替换为 ¥Y.YY，将 Cost (USD) 替换为 Cost (CNY)。
 * 处理 chunk 边界上的不完整 $ 数字。
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
      // 缓存任何以 $ 结尾的内容（甚至单独的 $），因为 $ 可能是一个数字的开始
      // 但如果是完整的 $ 数字（如 $12.34），则不缓存
      const partial = text.match(/\$\d*\.?\d*$/);
      if (partial && partial[0].length > 0 && !/\.\d+$/.test(partial[0])) {
        remainder = partial[0];
        text = text.slice(0, -partial[0].length);
      }

      // USD → CNY（捕获前导空格，保持表格列宽不变）
      // 乘以汇率后数字位数可能增加（如 $2.58 → ¥18.58），
      // 必须保持替换前后字符总宽度一致，否则表格列错位。
      // ANSI 转义序列在计算宽度时视为不可见字符。
      text = text.replace(
        /( *)(\x1b\[[\d;]+m)?\$(\d+\.?\d*)/g,
        (match, spaces, ansi, amount) => {
          const cny = (parseFloat(amount) * rate).toFixed(2);
          const newValue = `¥${cny}`;
          const ansiCode = ansi || '';

          // 可见内容宽度 = 总匹配长 - ANSI（不可见）
          const visibleWidth = match.length - ansiCode.length;

          if (spaces.length < 2 && !ansiCode) {
            // 词间分隔（0~1 空格且无 ANSI），保持原样
            return spaces + newValue;
          }

          // 表格列填充（≥2 空格或有 ANSI），padStart 保证可见宽度不变
          return ansiCode + newValue.padStart(visibleWidth);
        }
      );

      // 替换列标题（含分行场景：表头中 Cost 和 (USD) 可能在不同行）
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

/**
 * 创建 JSON 模式的 Transform stream
 *
 * 收集完整 stdout → JSON.parse → 递归查找费用字段 → 追加 CNY 等值 → JSON.stringify 输出。
 *
 * @param {number} rate - USD→CNY 汇率
 * @returns {import('node:stream').Transform}
 */
export function createJsonTransform(rate) {
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
      try {
        const data = JSON.parse(raw);
        const converted = addCostCNY(data, rate);
        const indent = detectJsonIndent(raw);
        this.push(JSON.stringify(converted, null, indent), 'utf-8');
      } catch {
        // JSON 解析失败，原样透传（不崩溃）
        this.push(raw, 'utf-8');
      }
      callback();
    },
  });
}
