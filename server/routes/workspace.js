/*
工作区 HTTP 插件：接收主页工作区触发，并将所有业务修改交给 Workspace 指令。
列表响应在出口组合 Session 摘要，持久化指令之间不形成隐式依赖。
调用示例：new Elysia().use(workspaceRoutes)。
*/
import { Elysia } from 'elysia'                         // 引入可组合的 HTTP 路由能力
import { Workspace } from '../commands/workspace.js'   // 引入工作区资源指令
import { Responses } from '../responses.js'            // 引入统一指令响应转换器
import { Schemas } from '../schemas.js'                 // 引入工作区请求模型


export const workspaceRoutes = new Elysia({ name: 'agent.routes.workspace', prefix: '/workspace' }) // 工作区使用设计规定根路径
  .use(Schemas)                                          // 继承集中请求验证模型
  .get('', () => Workspace.listWithSessions())           // 获取全部工作区及下属会话
  .post('', async ({ body }) => Responses.command(await Workspace.create(body.path, body.name)), { body: 'WorkspaceCreate' }) // 添加真实目录定义
  .patch('', async ({ body }) => Responses.command(await Workspace.update(body.workspaceId, body)), { body: 'WorkspaceUpdate' }) // 修改名称或目录
  .delete('', async ({ body }) => Responses.command(await Workspace.remove(body.workspaceId)), { body: 'WorkspaceRemove' }) // 仅移除列表定义
