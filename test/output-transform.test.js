// @ts-check
import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { createTextTransform, createJsonTransform } from '../src/output-transform.js';

/**
 * 将字符串通过 TextTransform 管道处理并返回结果
 *
 * @param {string} input - 输入文本
 * @param {number} rate - 汇率
 * @returns {Promise<string>} 转换后的文本
 */
function pipeThroughText(input, rate) {
  return new Promise((resolve, reject) => {
    const transform = createTextTransform(rate);
    const chunks = [];
    transform.on('data', (chunk) => chunks.push(chunk));
    transform.on('end', () => resolve(chunks.join('')));
    transform.on('error', reject);
    transform.write(input, 'utf-8');
    transform.end();
  });
}

/**
 * 通过 JSONTransform 管道处理并返回结果
 *
 * @param {string} input - 输入 JSON 字符串
 * @param {number} rate - 汇率
 * @returns {Promise<string>} 转换后的 JSON 字符串
 */
function pipeThroughJson(input, rate) {
  return new Promise((resolve, reject) => {
    const transform = createJsonTransform(rate);
    const chunks = [];
    transform.on('data', (chunk) => chunks.push(chunk));
    transform.on('end', () => resolve(chunks.join('')));
    transform.on('error', reject);
    transform.write(input, 'utf-8');
    transform.end();
  });
}

/**
 * 模拟 chunk 边界：将文本按指定边界分割成多个 chunk 进行流式传输
 *
 * @param {string} input - 输入文本
 * @param {number} rate - 汇率
 * @param {number[]} boundaries - 分割点索引数组
 * @returns {Promise<string>} 转换后的文本
 */
function pipeThroughTextWithChunks(input, rate, boundaries) {
  return new Promise((resolve, reject) => {
    const transform = createTextTransform(rate);
    const chunks = [];
    transform.on('data', (chunk) => chunks.push(chunk));
    transform.on('end', () => resolve(chunks.join('')));
    transform.on('error', reject);

    // 按指定边界分割写入
    let prev = 0;
    for (const boundary of [...boundaries, input.length]) {
      const segment = input.slice(prev, boundary);
      transform.write(segment, 'utf-8');
      prev = boundary;
    }
    transform.end();
  });
}

describe('createTextTransform', () => {
  it('测试 1: 文本模式中 $12.34 被替换为正确的 CNY 值（默认汇率 7.2）', async () => {
    const result = await pipeThroughText('$12.34', 7.2);
    expect(result).toContain('¥88.85');
    expect(result).not.toContain('$12.34');
  });

  it('测试 2: 文本模式中 $0.50 被替换为 ¥3.60', async () => {
    const result = await pipeThroughText('$0.50', 7.2);
    expect(result).toContain('¥3.60');
  });

  it('测试 3: 文本模式中 Cost (USD) 列标题被替换为 Cost (CNY)', async () => {
    const result = await pipeThroughText('Cost (USD)', 7.2);
    expect(result).toContain('Cost (CNY)');
    expect(result).not.toContain('Cost (USD)');
  });

  it('测试 4: chunk 边界（如 "$1" 结尾、"2.34" 开头）不破坏替换', async () => {
    // 故意在 "$12" 之后分割，让 ".34" 在下一个 chunk
    const input = '费用: $12.34 总计';
    const result = await pipeThroughTextWithChunks(input, 7.2, [5, 8]);
    expect(result).toContain('¥88.85');
    expect(result).not.toContain('$12.34');
  });

  it('测试 9: 非费用的 $ 符号（如路径 /dev/$project）不被转换', async () => {
    const result = await pipeThroughText('/dev/$project', 7.2);
    expect(result).toContain('/dev/$project');
  });

  it('多个费用值全部替换', async () => {
    const result = await pipeThroughText('$1.00 $2.00 $3.00', 7.2);
    expect(result).toBe('¥7.20 ¥14.40 ¥21.60');
  });

  it('非美元数字格式保持不变', async () => {
    const input = '行 1: 总计 100 个 token';
    const result = await pipeThroughText(input, 7.2);
    expect(result).toBe(input);
  });

  it('自定义汇率生效（默认为 7.0）', async () => {
    const result = await pipeThroughText('$10.00', 7.0);
    expect(result).toContain('¥70.00');
  });

  it('flush 时输出剩余的 remainder', async () => {
    // 输入以不完整的 "$" 结束，没有数字跟随
    const result = await pipeThroughText('剩余: $', 7.2);
    // "$" 单独不匹配数字，应原样输出
    expect(result).toBe('剩余: $');
  });
});

describe('createJsonTransform', () => {
  it('测试 5: JSON 模式中原始 costUSD 保留，自动追加 costCNY', async () => {
    const input = JSON.stringify({ costUSD: 12.34 });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.costUSD).toBe(12.34);
    expect(parsed.costCNY).toBe(88.85);
  });

  it('测试 6: JSON 模式中非 cost 数字字段不被追加（如 id, count）', async () => {
    const input = JSON.stringify({ id: 123, count: 5, costUSD: 10 });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe(123);
    expect(parsed.count).toBe(5);
    expect(parsed.costCNY).toBe(72);
    expect(Object.keys(parsed).length).toBe(4); // id, count, costUSD, costCNY
  });

  it('测试 7: JSON 模式遇到无效 JSON 时原样透传（不崩溃）', async () => {
    const input = '这不是 JSON';
    const result = await pipeThroughJson(input, 7.2);
    expect(result).toBe(input);
  });

  it('测试 8: JSON 模式保持原始缩进格式', async () => {
    const input = '{\n    "costUSD": 10\n}';
    const result = await pipeThroughJson(input, 7.2);
    expect(result).toContain('    "costUSD": 10');
    expect(result).toContain('    "costCNY": 72');
  });

  it('深度嵌套对象中的 cost 字段', async () => {
    const input = JSON.stringify({
      meta: { timestamp: '2024-01-01' },
      data: { costUSD: 50, totalCost: 100 },
    });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.data.costCNY).toBe(360);
    expect(parsed.data.totalCostCNY).toBe(720);
  });

  it('数组中的 cost 字段', async () => {
    const input = JSON.stringify([{ costUSD: 10 }, { costUSD: 20 }]);
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed[0].costCNY).toBe(72);
    expect(parsed[1].costCNY).toBe(144);
  });

  it('total_cost 和 charge 等字段名也支持', async () => {
    const input = JSON.stringify({ total_cost: 50, charge: 30, price: 20, fee: 10, spend: 5 });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.total_costCNY).toBe(360);
    expect(parsed.chargeCNY).toBe(216);
    expect(parsed.priceCNY).toBe(144);
    expect(parsed.feeCNY).toBe(72);
    expect(parsed.spendCNY).toBe(36);
  });

  it('null 和嵌套 null 不崩溃', async () => {
    const input = JSON.stringify({ costUSD: null, nested: { costUSD: null } });
    const result = await pipeThroughJson(input, 7.2);
    const parsed = JSON.parse(result);
    expect(parsed.costUSD).toBeNull();
    expect(parsed.nested.costUSD).toBeNull();
  });
});
