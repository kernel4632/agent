/* core 0.27 的 AI SDK 用量统一成历史和 llm-finish 使用的字段。 */
const usageOf = ({ usage, startedAt, finishedAt }) => {
    const input = Number(usage?.inputTokens ?? 0)
    const output = Number(usage?.outputTokens ?? 0)
    return {
        input,
        output,
        cacheRead: Number(usage?.inputTokenDetails?.cacheReadTokens ?? 0),
        cacheWrite: Number(usage?.inputTokenDetails?.cacheWriteTokens ?? 0),
        reasoning: Number(usage?.outputTokenDetails?.reasoningTokens ?? 0),
        total: Number(usage?.totalTokens ?? input + output),
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
    }
}

export default usageOf
