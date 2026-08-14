/*
MCP 插件：连接配置中的 HTTP、SSE 或 stdio 服务器，并把远端工具注册为普通 AgentTool。
内核只看到“服务名__工具名”，卸载插件会关闭全部客户端和子进程。
*/
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import type { AgentTool, PluginModule } from '../../types.ts'

export default async (api: any): Promise<PluginModule> => {
    const servers = (api.Store.config.plugins.mcp?.settings as any)?.servers ?? {}
    const clients: MCPClient[] = []
    const tools: AgentTool[] = []

    try {
        for (const [serverName, server] of Object.entries(servers) as [string, any][]) {
            if (server.enabled === false) continue
            const timeout = server.timeout ?? 10_000
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
            clients.push(client)

            let cursor: string | undefined
            do {
                const page = await client.listTools({ params: cursor ? { cursor } : undefined, options: { timeout, maxTotalTimeout: timeout } })
                for (const definition of page.tools) tools.push({
                    name: `${serverName}__${definition.name}`,
                    description: definition.description ?? `Call ${definition.name} on MCP server ${serverName}.`,
                    inputSchema: definition.inputSchema,
                    execute: async (input, context) => {
                        const call = () => client.callTool({
                            name: definition.name,
                            arguments: input as Record<string, unknown>,
                            options: { signal: context.signal, timeout, maxTotalTimeout: timeout },
                        })
                        return { output: context.retry ? await context.retry(call) : await call() }
                    },
                })
                cursor = page.nextCursor
            } while (cursor)
        }
    } catch (error) {
        await Promise.allSettled(clients.map(client => client.close()))
        throw error
    }

    return {
        name: 'mcp',
        tools,
        unload: () => Promise.all(clients.map(client => client.close())),
    }
}
