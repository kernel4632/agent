/*
 * 上下文用量台账：记住每条会话"这一轮实际用了多少、预算是多少"。
 *
 * 数据来源是 agent-core 的 onInject 回调——每轮请求前（压缩之后）它会交来
 * { tokens, budget, compactThreshold }，那是这一轮真实要发出去的估算值。
 *
 * 为什么值得单独记一份：模型看不见自己的上下文还剩多少，就只能瞎猜该不该
 * 把结论落盘、该不该提前收尾。压缩一来，中间推理就没了。把这个数字交给模型，
 * 它才能自己决定什么时候该写 checkpoint。
 *
 * 只在内存里，重启即清（重启后第一笔请求会重新填上）。不写盘是故意的：
 * 这是"当前这一轮"的瞬时状态，跨重启的历史值没有意义，反而会误导。
 */

// sessionId → { tokens, budget, compactThreshold, updatedAt, sampled }
const usage = new Map()

/**
 * 记一次当前用量。
 * @param {string} sessionId 哪条会话
 * @param {{ tokens?: number, budget?: number, compactThreshold?: number }} sample onInject 交来的值
 */
const record = (sessionId, sample = {}) => {
    if (!sessionId) return
    const tokens = Number(sample.tokens)
    const budget = Number(sample.budget)
    if (!Number.isFinite(tokens) || !Number.isFinite(budget) || budget <= 0) return
    const threshold = Number(sample.compactThreshold)
    usage.set(sessionId, {
        tokens: Math.max(0, Math.round(tokens)),
        budget: Math.round(budget),
        compactThreshold: Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : 0.8,
        updatedAt: Date.now(),
    })
}

/**
 * 读一条会话的用量；还没跑过任何一轮时返回 null。
 * 派生字段都算好给模型直接用，省得它自己乘阈值。
 */
const read = sessionId => {
    const entry = usage.get(sessionId)
    if (!entry) return null
    const compactAt = Math.round(entry.budget * entry.compactThreshold)
    const ratio = entry.tokens / entry.budget
    return {
        tokens: entry.tokens,
        budget: entry.budget,
        compactThreshold: entry.compactThreshold,
        // 压缩点：到这个 token 数就会触发压缩
        compactAt,
        // 距压缩点还剩多少；负数表示已经压在门槛上方（压缩可能正在发生或刚刚发生）
        untilCompact: compactAt - entry.tokens,
        // 用了整个预算的百分之几，一位小数
        percentOfBudget: Math.round(ratio * 1000) / 10,
        updatedAt: entry.updatedAt,
    }
}

/** 会话删除时清掉；不清理的话内存会随会话数量一直长。 */
const remove = sessionId => { usage.delete(sessionId) }

export { record, read, remove }
export default { record, read, remove }
