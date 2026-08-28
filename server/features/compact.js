/* 
目标被调用形式（绝对不可修改）：
const { messages, token } = await Compact.run({
    sessionId: "session-1",        // 用来读取当前会话正在使用的模型
    messages: messages,            // build 后的 messages
    token: token,                  // 当前 token 数
    maxTokens: 8000,               // 最大上下文
    stream: true,                  // 是否流式生成总结
    onCompact: event => {},        // compact-start / compact-text / compact-finish
})
// onCompact compact-start: { type, messages, token, maxTokens }
// onCompact compact-text: { type, text }
// onCompact compact-finish: { type, messages, token }
*/

import { countTokens } from 'gpt-tokenizer'
import Message from '../utils/message.js'
import LLM from '../utils/llm.js'
import Path from '../utils/path.js'

const readJson = async path => {
    const file = Bun.file(path)
    if (!await file.exists()) throw new Error(`File not found: ${path}`)
    return file.json()
}

const getModelConfig = async sessionId => {
    // 会话只保存“选了谁”，真正的地址和密钥统一从全局配置读取。
    const session = await readJson(Path.meta(sessionId))
    const config = await readJson(Path.config())
    const provider = (config.providers || []).find(item => item.name === session.provider)
    if (!provider) throw new Error(`Provider not found: ${session.provider}`)

    const model = typeof session.model === 'object' ? session.model.id : session.model
    if (!model) throw new Error(`Model not found for session: ${sessionId}`)

    let headers = provider.headers || {}
    if (typeof headers === 'string') headers = JSON.parse(headers || '{}')
    return {
        llm: {
            baseURL: provider.baseURL,
            apiKey: provider.apiKey || provider.key,
            model,
            protocol: provider.protocol === 'openai-compatible' ? 'chat' : provider.protocol,
            options: { headers },
        },
    }
}

const run = async ({ sessionId, messages, token, maxTokens, onCompact, stream = true, llm }) => {
    if (!sessionId || !Array.isArray(messages) || !Number.isFinite(token) || !Number.isFinite(maxTokens)) {
        throw new TypeError('sessionId, messages, token and maxTokens are required')
    }

    if (!llm) ({ llm } = await getModelConfig(sessionId))
    // 没超限时返回原数组。Loop 用这个“同一个数组”判断是否需要重新构建。
    if (token <= maxTokens) return { messages, token } // 未超限时不发压缩事件，也不改变消息数组。

    await onCompact?.({ type: 'compact-start', messages, token, maxTokens }) // 开始事件让外部进入压缩状态。
    const output = []
    let callbackQueue = Promise.resolve()
    const result = await LLM.chat({
        ...llm,
        system: '请总结这段对话，只输出总结内容。',
        messages: [
            { role: 'user', content: `以下是需要压缩的对话内容：\n\n${JSON.stringify(messages)}\n\n请只输出这段对话的压缩总结，不要继续对话内容。` },
        ],
        stream,
        onChunk: ({ chunk }) => {
            if (chunk?.type !== 'text-delta') return
            const text = chunk.text ?? chunk.textDelta ?? chunk.delta
            if (!text) return
            output.push(text)
            if (onCompact) callbackQueue = callbackQueue.then(() => onCompact({ type: 'compact-text', text })) // 串行通知，保持文字顺序。
        },
    })
    await callbackQueue
    const content = output.join('') || result.text.trim()
    const summary = Message.compress({ content })
    if (!stream && content) await onCompact?.({ type: 'compact-text', text: content })
    const compacted = { messages: [summary], token: countTokens(content) }
    await onCompact?.({ type: 'compact-finish', ...compacted }) // 完成事件让外部退出压缩状态。
    return compacted
}

export default { run }
