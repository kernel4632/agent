/*
 * core 的 AI SDK 用量统一成历史和 llm-finish 使用的字段。
 * firstTokenAt 是这次请求收到第一个内容增量的时间；和 startedAt 相减就是首字时间（TTFT）。
 */
const usageOf = ({ usage, startedAt, finishedAt, firstTokenAt, provider, model }) => {
    const input = Number(usage?.inputTokens ?? 0)
    const output = Number(usage?.outputTokens ?? 0)
    const first = Number(firstTokenAt || 0)
    return {
        input,
        output,
        cacheRead: Number(usage?.inputTokenDetails?.cacheReadTokens ?? 0),
        cacheWrite: Number(usage?.inputTokenDetails?.cacheWriteTokens ?? 0),
        reasoning: Number(usage?.outputTokenDetails?.reasoningTokens ?? 0),
        total: Number(usage?.totalTokens ?? input + output),
        provider: typeof provider === 'string' ? provider : '',
        model: typeof model === 'string' ? model : '',
        startedAt,
        firstTokenAt: first,
        firstTokenMs: first && startedAt ? Math.max(0, first - startedAt) : 0,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
    }
}

export default usageOf
