/*
 * 请求用量：把服务端固定字段的 token 用量整理成界面字段。
 *
 * 实时事件和历史回放共用这一份，避免两处各算一套。
 * 调用示例：
 *   const usage = usageFields({ input: 30, output: 20, cacheRead: 10, total: 50 })
 *   const request = requestFromUsage(item.usage)
 */

// --- 用量字段统一成界面用的形状 ---
export function usageFields(usage = {}, durationMs = 0) {
  const input = Number(usage.input || 0)          // 这次请求送进模型的 token
  const output = Number(usage.output || 0)        // 模型生成的 token
  return {
    input,
    output,
    cache: Number(usage.cacheRead || 0),          // 命中缓存的输入 token
    cacheWrite: Number(usage.cacheWrite || 0),    // 写进缓存的输入 token
    reasoning: Number(usage.reasoning || 0),      // 思考过程消耗的 token
    total: Number(usage.total ?? input + output), // 服务端没给总数时自己加
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
