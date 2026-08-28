/*
目标被调用形式（绝对不可修改）：
const content = await Compact.run({
    messages: messages,            // 需要压缩的上下文消息
    llm: {                          // 用来生成总结的模型配置
        baseURL: "https://中转站/v1",
        apiKey: "sk-xxx",
        model: "model-name",
        protocol: "chat",
    },
    stream: true,                  // 是否流式生成总结
    onCompact: event => {},        // compact-start / compact-text / compact-finish
})
// content = "压缩后的总结文本"
// onCompact compact-start: { type, messages }
// onCompact compact-text: { type, text }
// onCompact compact-finish: { type, content }
*/

import LLM from '../utils/llm.js'

// Compact 只负责把上下文变成总结文本，是否需要压缩由调用方决定。
const run = async ({ messages, llm, stream = true, onCompact, signal }) => {
    await onCompact?.({ type: 'compact-start', messages })
    const output = []
    let callbackQueue = Promise.resolve()
    const result = await LLM.chat({
        ...llm,
        system: '请总结这段对话，只输出总结内容。',
        messages: [
            { role: 'user', content: `以下是需要压缩的对话内容：\n\n${JSON.stringify(messages)}\n\n请只输出这段对话的压缩总结，不要继续对话内容。` },
        ],
        stream,
        signal,
        onChunk: ({ chunk }) => {
            if (chunk?.type !== 'text-delta') return
            const text = chunk.text ?? chunk.textDelta ?? chunk.delta
            if (!text) return
            output.push(text)
            if (onCompact) callbackQueue = callbackQueue.then(() => onCompact({ type: 'compact-text', text }))
        },
    })
    await callbackQueue
    const content = output.join('') || result.text.trim()
    if (!stream && content) await onCompact?.({ type: 'compact-text', text: content })
    await onCompact?.({ type: 'compact-finish', content })
    return content
}

export default { run }
