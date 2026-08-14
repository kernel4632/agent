/*
上下文组装：选择开头、最新摘要附近和摘要后的消息，并转换为 AI SDK ModelMessage。
Context.count 与 Context.needsCompact 也公开，压缩和插件可复用同一套判断。
*/
import { convertToModelMessages, type ToolSet } from 'ai'
import { encode } from 'gpt-tokenizer'
import type { AgentMessage, ModelConfig } from '../types.ts'

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

const needsCompact = (messages: AgentMessage[], model: ModelConfig, ratio: number) =>
    encode(JSON.stringify(select(messages))).length > model.contextWindow * ratio

const build = async (messages: AgentMessage[], tools: ToolSet) =>
    convertToModelMessages(select(messages), { tools, ignoreIncompleteToolCalls: true })

const request = async (messages: AgentMessage[], tools: ToolSet, prompts: string[]) => ({
    messages: await build(messages, tools),
    tools,
    instructions: prompts.filter(Boolean).join('\n\n'),
})

export default { select, needsCompact, build, request }
