/*
Agent HTTP 插件：展示可用 Agent 定义，让前端为每个会话选择不同模型和提示词。
权限、工具、MCP、LSP、Skills 与工作区不属于 Agent 定义，继续由服务端全局共享。
调用示例：new Elysia().use(agentRoutes)。
*/
import { Elysia } from 'elysia'                         // 引入可组合的 Elysia 路由能力
import { Agent } from '../commands/agent.js'             // 引入 Agent 目录查询指令
import { Schemas } from '../schemas.js'                  // 引入 Agent 定义命名模型


export const agentRoutes = new Elysia({ name: 'agent.routes.agent', prefix: '/agent' }) // Agent API 使用独立前缀插件
  .use(Schemas)                                           // 继承集中注册的请求模型
  .get('/list', () => Agent.list())                      // 返回模型选择目录
  .get('/:id', ({ params }) => Agent.get(params.id) || Response.json({ error: 'agent not found' }, { status: 404 })) // 返回单个 Agent 快照
  .post('/', async ({ body }) => Agent.save(null, body), { body: 'AgentDefinition' }) // 新增一个共享环境下的模型选择
  .put('/:id', async ({ params, body }) => Agent.save(params.id, body), { body: 'AgentDefinition' }) // 更新一个 Agent 的模型选择
