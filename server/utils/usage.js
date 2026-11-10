/*
 * core 的 AI SDK 用量统一成历史和 llm-finish 使用的字段。
 * firstTokenAt 是这次请求收到第一个内容增量的时间；和 startedAt 相减就是首字时间（TTFT）。
 *
 * 这里的 usage 来自外部供应商，属于系统边界：必须校验一次再往下传。
 * 有供应商会返回 null、字符串、负数，甚至把累计值当单次值发过来（Cline 型 bug）；
 * 不拦住的话，统计面板会显示 908.7M tokens 这种数字，用户无从判断真假。
 */

// 单次请求的 token 不可能超过这个量级：目前最大的模型上下文也只有 2M 左右。
// 超过就视为脏数据，按 0 处理并把原因记下来，而不是让它污染累计统计。
const MAX_TOKENS = 5_000_000

/**
 * 把一个可能脏的 token 数字压成可信的非负整数。
 * @param {unknown} value 供应商返回的原始值
 * @returns {number} 可信的 token 数；不可信时返回 0
 */
const tokens = value => {
    const number = Number(value)
    // NaN、Infinity、负数、超过上限，都不是真实的 token 计数
    if (!Number.isFinite(number) || number < 0 || number > MAX_TOKENS) return 0
    return Math.round(number)
}

const usageOf = ({ usage, startedAt, finishedAt, firstTokenAt, generationMs, provider, model }) => {
    const input = tokens(usage?.inputTokens)
    const output = tokens(usage?.outputTokens)
    const first = Number(firstTokenAt || 0)
    // 生成窗口只包括正文/工具参数的可见输出，不含 reasoning。
    const generation = Number(generationMs || 0)
    // 供应商没给总数时自己加；给了也要校验，脏值退回到自己算的那份
    const reported = tokens(usage?.totalTokens)
    return {
        input,
        output,
        cacheRead: tokens(usage?.inputTokenDetails?.cacheReadTokens),
        cacheWrite: tokens(usage?.inputTokenDetails?.cacheWriteTokens),
        reasoning: tokens(usage?.outputTokenDetails?.reasoningTokens),
        total: reported || input + output,
        provider: typeof provider === 'string' ? provider : '',
        model: typeof model === 'string' ? model : '',
        startedAt,
        firstTokenAt: first,
        firstTokenMs: first && startedAt ? Math.max(0, first - startedAt) : 0,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        generationMs: Number.isFinite(generation) && generation > 0 ? Math.round(generation) : 0,
    }
}

export { MAX_TOKENS, tokens }
export default usageOf
