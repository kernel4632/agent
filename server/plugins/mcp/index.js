/* MCP 远端工具使用“服务名__工具名”避免重名。 */
import { createMCPClient } from '@ai-sdk/mcp' // 连接标准 MCP 服务并发现工具。
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio' // 启动本地 stdio MCP 服务。

export default async api => {
    const servers = api.Store.config.plugins.mcp?.settings?.servers || {} // 读取所有已配置服务。
    const clients = [] // 记录连接，失败或卸载时统一关闭。
    const tools = [] // 收集后续注入 Agent 的动态工具。

    try {
        for (const [serverName, server] of Object.entries(servers)) {
            if (server.enabled === false) continue // 禁用服务不建立连接。

            const timeout = server.timeout || 10_000 // 每个 MCP 请求默认最多等待十秒。
            const transport = server.type === 'stdio'
                ? new Experimental_StdioMCPTransport({
                    command: server.command[0],
                    args: server.command.slice(1),
                    env: server.environment,
                    cwd: server.cwd,
                })
                : { type: server.type, url: server.url, headers: server.headers }
            const client = await createMCPClient({
                transport,
                maxRetries: 0,
                initializationOptions: { timeout, maxTotalTimeout: timeout },
            })
            clients.push(client) // 连接成功后立即纳入卸载管理。
            let cursor // MCP 工具列表可能分页返回。

            do {
                const page = await client.listTools({
                    params: cursor ? { cursor } : undefined, // 下一页携带服务端 cursor。
                    options: { timeout, maxTotalTimeout: timeout }, // 分页请求受同一超时限制。
                })

                for (const definition of page.tools) {
                    tools.push({
                        name: `${serverName}__${definition.name}`, // 用服务名前缀避免工具重名。
                        description: definition.description || `Call ${definition.name} on ${serverName}.`,
                        inputSchema: definition.inputSchema,
                        async execute(input, context) {
                            const output = await client.callTool({ // 保持输入原样转交 MCP。
                                name: definition.name,
                                arguments: input,
                                options: {
                                    signal: context.signal,
                                    timeout,
                                    maxTotalTimeout: timeout,
                                },
                            })
                            return { output } // MCP 原始结果由 toModelOutput 继续转换。
                        },
                        toModelOutput(output) {
                            const structured = output.structuredContent !== undefined // 优先保留结构化结果。
                                ? output.structuredContent
                                : output.toolResult
                            const value = output.content?.length
                                ? output.content.map(part => {
                                    if (part.type === 'text') return { type: 'text', text: part.text } // 文本直接进入模型。
                                    if (part.type === 'image') return {
                                        type: 'file',
                                        data: { type: 'data', data: part.data },
                                        mediaType: part.mimeType,
                                    }
                                    if (part.type === 'resource' && part.resource?.text) {
                                        return { type: 'text', text: part.resource.text }
                                    }
                                    if (part.type === 'resource' && part.resource?.blob) return {
                                        type: 'file',
                                        data: { type: 'data', data: part.resource.blob },
                                        mediaType: part.resource.mimeType,
                                    }
                                    if (part.type === 'resource_link') {
                                        return { type: 'text', text: `${part.name || 'resource'}: ${part.uri}` }
                                    }
                                    return { type: 'text', text: JSON.stringify(part) } // 未知内容保留为可检查 JSON。
                                })
                                : [{
                                    type: 'text',
                                    text: structured === undefined ? '' : JSON.stringify(structured),
                                }]
                            return { type: 'content', value } // AI SDK 按多模态内容格式接收结果。
                        },
                    })
                }
                cursor = page.nextCursor // 有下一页时继续发现工具。
            } while (cursor)
        }
    } catch (error) {
        // 初始化任一服务失败时，关闭之前已经连接的客户端。
        await Promise.allSettled(clients.map(client => client.close())) // 释放已连接服务。
        throw error // 保留初始化失败原因给插件加载方。
    }

    return { name: 'mcp', tools, unload: () => Promise.all(clients.map(client => client.close())) } // 卸载时断开全部服务。
}
