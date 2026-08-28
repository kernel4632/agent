/* 
目标被调用形式（绝对不可修改）：
const { messages, token } = Context.build({
    history: History.get(),       // 完整历史
    system: "你是编程助手。",     // 会进入 messages 并参与 Token 估算
    tools: {},                    // 工具定义参与 Token 估算，不进入 messages
})
*/

import { countTokens } from 'gpt-tokenizer'

// 最前面的消息保留用户最初目标；总结前的消息保留当前任务的最近过程。
const KEEP_FIRST = 3
const KEEP_BEFORE_SUMMARY = 3

const forModel = message => {
    // History 只比 AI SDK 多了顶层内部字段，去掉它们后直接交给模型。
    return { role: message.role, content: message.content }
}

const build = ({ history, system = '', tools = {} }) => {
    // 从后往前找，确保多次压缩后只使用最新总结。
    const summaryIndex = history.findLastIndex(message => message.compact === true)
    let selected

    if (summaryIndex < 0) {
        // 没有压缩总结时，完整历史就是最准确的上下文。
        selected = history
    } else {
        const first = history.slice(0, Math.min(KEEP_FIRST, summaryIndex))

        // 跳过已经放进 first 的消息，避免短历史中出现重复内容。
        const beforeStart = Math.max(first.length, summaryIndex - KEEP_BEFORE_SUMMARY)
        const beforeSummary = history.slice(beforeStart, summaryIndex)
        const summary = history[summaryIndex]
        const afterSummary = history.slice(summaryIndex + 1)

        // 顺序固定：最初目标 → 最新总结 → 总结前现场 → 总结后新消息。
        selected = [...first, summary, ...beforeSummary, ...afterSummary]
    }

    const messages = [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...selected.map(forModel),
    ]

    // 工具定义不属于 messages，但模型请求仍会携带它们，所以估算时一并计算。
    const token = countTokens(JSON.stringify({ messages, tools }))
    return { messages, token }
}

export default { build }
