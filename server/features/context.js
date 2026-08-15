/* 只选择模型此刻需要看到的消息，并组装模型请求。 */
import { convertToModelMessages, dynamicTool, jsonSchema } from 'ai'
import { encode } from 'gpt-tokenizer'
import Store from '../store.js'
import Tool from '../utils/tool.js'
import Plugin from './plugin.js'

const count = messages => {
    const summary = messages.findLastIndex(message => message.summary)
    if (summary < 0) return encode(JSON.stringify(messages)).length

    const selected = [
        ...messages.slice(0, 3),
        ...messages.slice(Math.max(3, summary - 3), summary + 1),
        ...messages.slice(summary + 1),
    ]
    const unique = selected.filter((message, index) => {
        return selected.findIndex(item => item.id === message.id) === index
    })
    return encode(JSON.stringify(unique)).length
}

const build = async sessionID => {
    const session = Store.sessions[sessionID]
    const workspace = Store.workspaces[session.workspaceID]
    const available = await Tool.list(workspace.path)
    // Tool.execute 保留的是同一个快照对象，插件工具也会进入执行集合。
    Object.assign(available, Plugin.tools())

    // 摘要之后只保留开头、摘要附近和摘要之后的新消息。
    const summary = session.messages.findLastIndex(message => message.summary)
    const selected = summary < 0 ? session.messages : [
        ...session.messages.slice(0, 3),
        ...session.messages.slice(Math.max(3, summary - 3), summary + 1),
        ...session.messages.slice(summary + 1),
    ]
    const messages = selected.filter((message, index) => {
        return selected.findIndex(item => item.id === message.id) === index
    })

    const modelTools = Object.fromEntries(Object.values(available).map(tool => {
        const definition = {
            description: tool.description,
            inputSchema: jsonSchema(tool.inputSchema),
        }
        if (tool.toModelOutput) definition.toModelOutput = ({ output }) => tool.toModelOutput(output)
        return [tool.name, dynamicTool(definition)]
    }))

    return {
        messages: await convertToModelMessages(messages, { tools: modelTools, ignoreIncompleteToolCalls: true }),
        tools: available,
        instructions: [Store.config.prompts.system, Store.config.prompts.tool].filter(Boolean).join('\n\n'),
    }
}

export default { build, count }
