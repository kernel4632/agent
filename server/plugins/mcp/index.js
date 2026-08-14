/* MCP 远端工具使用“服务名__工具名”避免重名。 */
import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'

export default async api => {
    const servers = api.Store.config.plugins.mcp?.settings?.servers || {}
    const clients = []
    const tools = []
    try {
        for (const [serverName, server] of Object.entries(servers)) {
            if (server.enabled === false) continue
            const timeout = server.timeout || 10_000
            const transport = server.type === 'stdio'
                ? new Experimental_StdioMCPTransport({ command: server.command[0], args: server.command.slice(1), env: server.environment, cwd: server.cwd })
                : { type: server.type, url: server.url, headers: server.headers }
            const client = await createMCPClient({ transport, maxRetries: 0, initializationOptions: { timeout, maxTotalTimeout: timeout } })
            clients.push(client)
            let cursor
            do {
                const page = await client.listTools({ params: cursor ? { cursor } : undefined, options: { timeout, maxTotalTimeout: timeout } })
                for (const definition of page.tools) tools.push({
                    name: `${serverName}__${definition.name}`,
                    description: definition.description || `Call ${definition.name} on ${serverName}.`,
                    inputSchema: definition.inputSchema,
                    async execute(input, context) {
                        const output = await client.callTool({
                            name: definition.name, arguments: input,
                            options: { signal: context.signal, timeout, maxTotalTimeout: timeout },
                        })
                        return { output }
                    },
                })
                cursor = page.nextCursor
            } while (cursor)
        }
    } catch (error) {
        await Promise.allSettled(clients.map(client => client.close()))
        throw error
    }
    return { name: 'mcp', tools, unload: () => Promise.all(clients.map(client => client.close())) }
}
