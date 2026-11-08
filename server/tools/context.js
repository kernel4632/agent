/*
 * 上下文用量工具：告诉模型"这条会话现在占了多少上下文、离压缩还有多远"。
 *
 * 为什么模型需要这个：压缩一发生，中间推理就没了。没有用量信息时，
 * 模型只能瞎猜"现在该把结论落盘，还是继续在内存里推"，猜错的代价是
 * 一整段工作被压缩掉。有了这个数字，它能自己决定什么时候写 checkpoint、
 * 什么时候收窄范围、什么时候收尾。
 *
 * 数据来自 agent-core 的 onInject（每轮请求前给出压缩之后的真实估算值），
 * 由 utils/context-usage.js 记账；本工具只负责读。
 *
 * 调用示例：模型调用 ctx_usage({})
 */

import ContextUsage from '../utils/context-usage.js'

const ctxUsage = {
    name: 'ctx_usage',
    kind: 'read',
    ui: {
        view: 'stats',
        icon: 'info',
        title: '上下文用量',
        summary: '查看余量',
    },
    description: [
        'Report how much context this conversation is using right now, and how far it is from the automatic compaction point.',
        'Call this when a task is long: if untilCompact is small, write important findings to a file or finish the current step before compaction drops the earlier reasoning.',
        'Numbers come from the last model request (after any compaction), so they describe the next request you are about to make.',
        'No parameters.',
    ].join('\n'),
    inputSchema: { type: 'object', properties: {} },

    async execute(input, options = {}) {
        const current = ContextUsage.read(options.sessionId)
        if (!current) {
            // 还没跑过任何一轮时没有真实数据；如实说明，不要编一个数字。
            return { available: false, note: 'No model request has run in this session yet, so there is no measured context usage. Call this again after one round.' }
        }
        return {
            available: true,
            ...current,
            // 给一句可执行的话，模型不用自己乘除再想该干什么。
            advice: current.untilCompact <= 0
                ? 'At or past the compaction point: wrap up this step and write anything worth keeping to a file.'
                : current.untilCompact < current.budget * 0.1
                    ? 'Close to compaction: finish the current step and persist key findings before starting anything new.'
                    : 'Plenty of room left.',
        }
    },

    // 直接给一句可读的话，别把 JSON 原样丢过去。
    toModelOutput({ output }) {
        if (!output?.available) return { type: 'text', value: output?.note || 'Context usage is not available yet.' }
        return {
            type: 'text',
            value: [
                `Context: ${output.tokens} of ${output.budget} tokens used (${output.percentOfBudget}%).`,
                `Compaction triggers at ${output.compactAt} tokens; ${output.untilCompact} tokens left before that.`,
                output.advice,
            ].join('\n'),
        }
    },
}

export default ctxUsage
