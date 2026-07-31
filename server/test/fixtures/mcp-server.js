/* MCP 测试服务：使用官方 SDK 暴露一个可验证的真实 stdio 工具。 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'     // 引入官方高层 MCP Server
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js' // 引入标准 stdio 传输
import { z } from 'zod'                                                // 引入工具输入校验

const server = new McpServer({ name: 'agent-test-mcp', version: '1.0.0' }) // 创建测试协议端点
server.registerTool('echo-value', { title: '回显测试值', description: 'Return a value through a real MCP call.', inputSchema: { value: z.string() } }, async ({ value }) => ({ content: [{ type: 'text', text: `MCP_REAL:${value}` }], structuredContent: { echoed: value } })) // 注册真实结构化工具
await server.connect(new StdioServerTransport())                       // 启动后持续消费父进程 stdio
