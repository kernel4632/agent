/* 只选择模型此刻需要看到的消息，并组装模型请求。 */
import { convertToModelMessages, dynamicTool, jsonSchema } from 'ai'
import { encode } from 'gpt-tokenizer'
import Store from '../store.js'
import Tool from '../utils/tool.js'
import Plugin from './plugin.js'

const select = messages => {
    const summary = messages.findLastIndex(message => message.summary)
    if (summary < 0) return messages
    const picked = [...messages.slice(0, 3), ...messages.slice(Math.max(3, summary - 3), summary + 1), ...messages.slice(summary + 1)]
    return picked.filter((message, index) => picked.findIndex(item => item.id === message.id) === index)
}
const count = messages => encode(JSON.stringify(select(messages))).length
const build = async sessionID => {
    const session = Store.sessions[sessionID]
    const workspace = Store.workspaces[session.workspaceID]
    const available = { ...await Tool.list(workspace.path), ...Plugin.tools() }
    const tools = Object.fromEntries(Object.values(available).map(tool => [tool.name, dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(tool.inputSchema),
        toModelOutput: tool.toModelOutput ? ({ output }) => tool.toModelOutput(output) : undefined,
    })]))
    return {
        messages: await convertToModelMessages(select(session.messages), { tools, ignoreIncompleteToolCalls: true }),
        tools,
        available,
        instructions: [Store.config.prompts.system, Store.config.prompts.tool].filter(Boolean).join('\n\n'),
    }
}

export default { build, count }
