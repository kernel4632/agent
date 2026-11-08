/*
 * 请求用量：把服务端固定字段的 token 用量整理成界面字段。
 *
 * 实时事件和历史回放共用这一份，避免两处各算一套。
 * 调用示例：
 *   const usage = usageFields({ input: 30, output: 20, cacheRead: 10, total: 50 })
 *   const request = requestFromUsage(item.usage)
 */

// --- 用量字段统一成界面用的形状 ---
// 单次请求的 token 不可能超过这个量级（现有最大模型上下文约 2M）。
// 超过按戳数据处理：统计面板曾因此显示过 908.7M tokens。
export const MAX_TOKENS = 5_000_000

/** 把可能脏的 token 数字压成可信的非负整数；不可信时返回 0。 */
function tokens(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > MAX_TOKENS) return 0 // NaN、Infinity、负数、超上限
  return Math.round(number)
}

export function usageFields(usage = {}, durationMs = 0) {
  const input = tokens(usage.input)              // 这次请求送进模型的 token
  const output = tokens(usage.output)            // 模型生成的 token
  return {
    input,
    output,
    cache: tokens(usage.cacheRead),              // 命中缓存的输入 token
    cacheWrite: tokens(usage.cacheWrite),        // 写进缓存的输入 token
    reasoning: tokens(usage.reasoning),          // 思考过程消耗的 token
    total: tokens(usage.total) || input + output, // 服务端没给总数或给了戳值时自己加
    provider: typeof usage.provider === 'string' ? usage.provider : '',
    model: typeof usage.model === 'string' ? usage.model : '',
    firstTokenAt: Number(usage.firstTokenAt || 0), // 第一个内容增量到达的绝对时间
    firstTokenMs: Number(usage.firstTokenMs || 0), // 首字时间（TTFT）
    durationMs: Number(durationMs || usage.durationMs || 0), // 请求完整耗时
  }
}

// --- 历史里的用量变成一条请求行 ---
export function requestFromUsage(usage) {
  if (!usage) return null
  return {
    status: 'completed',
    startedAt: Number(usage.startedAt || 0),
    finishedAt: Number(usage.finishedAt || 0),
    ...usageFields(usage),
  }
}
