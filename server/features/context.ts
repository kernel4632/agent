/*
上下文组装：选择开头、最新摘要附近和摘要后的消息，并转换为 AI SDK ModelMessage。
Context.count 与 Context.needsCompact 也公开，压缩和插件可复用同一套判断。
*/
import { convertToModelMessages, type ToolSet } from 'ai'
import { encode } from 'gpt-tokenizer'
import Store from '../store.ts'
import type { AgentMessage } from '../types.ts'

const select = (messages: AgentMessage[]) => {
    const summaryIndex = messages.findLastIndex(message => message.summary)
    if (summaryIndex < 0) return messages

    const selected = [
        ...messages.slice(0, 3),
        ...messages.slice(Math.max(3, summaryIndex - 3), summaryIndex),
        messages[summaryIndex]!,
        ...messages.slice(summaryIndex + 1),
    ]
    return selected.filter((message, index) => selected.findIndex(item => item.id === message.id) === index)
}

const needsCompact = (sessionID: string, messages = select(Store.sessions[sessionID]!.messages)) => {
    const session = Store.sessions[sessionID]!
    const provider = Store.config.providers.find(item => item.name === session.provider)
    const model = provider?.models.find(item => item.id === session.model)
    if (!model) throw new Error('Session model configuration not found')
    return encode(JSON.stringify(messages)).length > model.contextWindow * Store.config.context.compactRatio
}

const build = async (sessionID: string, tools: ToolSet) => {
    const messages = select(Store.sessions[sessionID]!.messages)
    return convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true })
}

export default { select, needsCompact, build }
