/* 只选择模型此刻需要看到的消息，并组装模型请求。 */
import { convertToModelMessages, dynamicTool, jsonSchema } from 'ai' // 转换 AI SDK 消息和动态工具。
import { encode } from 'gpt-tokenizer' // 按真实 tokenizer 估算上下文大小。
import Store from '../store.js' // 读取会话、工作区和系统提示词。
import Tool from '../utils/tool.js' // 扫描内置、全局和工作区工具。
import Plugin from './plugin.js' // 合并插件提供的动态工具。

const count = messages => {
    const summary = messages.findLastIndex(message => message.summary) // 找到最新摘要锚点。
    if (summary < 0) return encode(JSON.stringify(messages)).length // 未压缩时计算完整历史。

    const selected = [
        ...messages.slice(0, 3),
        ...messages.slice(Math.max(3, summary - 3), summary + 1),
        ...messages.slice(summary + 1),
    ]
    const unique = selected.filter((message, index) => {
        return selected.findIndex(item => item.id === message.id) === index
    })
    return encode(JSON.stringify(unique)).length // 返回实际会送入模型的 token 数。
}

const build = async sessionID => {
    const session = Store.sessions[sessionID] // 读取这条会话的完整明文历史。
    const workspace = Store.workspaces[session.workspaceID] // 工具扫描需要工作区路径。
    const available = await Tool.list(workspace.path) // 本轮拿到独立工具快照。
    // Tool.execute 保留的是同一个快照对象，插件工具也会进入执行集合。
    Object.assign(available, Plugin.tools()) // 插件工具覆盖同名目录工具。

    // 摘要之后只保留开头、摘要附近和摘要之后的新消息。
    const summary = session.messages.findLastIndex(message => message.summary) // 定位最新摘要。
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
        if (tool.toModelOutput) definition.toModelOutput = ({ output }) => tool.toModelOutput(output) // 保留多模态输出。
        return [tool.name, dynamicTool(definition)] // 以工具名建立模型可调用表。
    }))

    return {
        messages: await convertToModelMessages(messages, { tools: modelTools, ignoreIncompleteToolCalls: true }),
        tools: available,
        instructions: [Store.config.prompts.system, Store.config.prompts.tool].filter(Boolean).join('\n\n'),
    }
}

export default { build, count } // 暴露上下文组装和 token 计数。
