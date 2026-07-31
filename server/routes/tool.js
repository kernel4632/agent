/*
工具 HTTP 插件：展示当前注册表并触发真实目录重扫。
重载目录由 server.js 装饰到 Elysia 上下文，插件不依赖应用启动参数的来源。
调用示例：new Elysia().decorate('directories', directories).use(toolRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合的路由插件能力
import { Tool } from '../commands/tool.js'            // 引入工具查询和重载指令


export const toolRoutes = new Elysia({ name: 'agent.routes.tool', prefix: '/tool' }) // 工具 API 使用独立前缀插件
  .get('/list', () => Tool.list())                    // 返回模型可见工具的公开描述
  .post(
    '/reload',                                        // 使用应用上下文中的真实目录重扫
    ({ directories }) => Tool.load([directories.builtInTools, directories.customTools]),
  )
