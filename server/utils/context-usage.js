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

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import Path from './path.js'

// sessionId → { tokens, budget, compactThreshold, updatedAt }
const usage = new Map()

const persist = (sessionId, entry) => {
    if (!sessionId || !entry) return
    void mkdir(Path.session(sessionId), { recursive: true })
        .then(() => writeFile(Path.contextUsage(sessionId), JSON.stringify(entry)))
        .catch(() => {})
}

/** 进程重启后恢复上一次采样；同一进程内仍以实时 record 为准。 */
const hydrate = async sessionId => {
    if (!sessionId || usage.has(sessionId)) return usage.get(sessionId) || null
    try {
        const entry = JSON.parse(await readFile(Path.contextUsage(sessionId), 'utf8'))
        const tokens = Number(entry?.tokens)
        const budget = Number(entry?.budget)
        const threshold = Number(entry?.compactThreshold)
        if (Number.isFinite(tokens) && Number.isFinite(budget) && budget > 0) {
            const restored = {
                tokens: Math.max(0, Math.round(tokens)),
                budget: Math.round(budget),
                compactThreshold: Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : 0.8,
                updatedAt: Number(entry.updatedAt) || 0,
            }
            usage.set(sessionId, restored)
            return restored
        }
    } catch {
        // 还没有采样或文件损坏，按未运行过处理。
    }
    return null
}

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
    const entry = {
        tokens: Math.max(0, Math.round(tokens)),
        budget: Math.round(budget),
        compactThreshold: Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : 0.8,
        updatedAt: Date.now(),
    }
    usage.set(sessionId, entry)
    persist(sessionId, entry)
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

/** 会话删除时清掉；不清理的话内存和最后一份采样文件都会留下。 */
const remove = sessionId => {
    usage.delete(sessionId)
    if (sessionId) void rm(Path.contextUsage(sessionId), { force: true }).catch(() => {})
}

export { record, read, hydrate, remove }
export default { record, read, hydrate, remove }
