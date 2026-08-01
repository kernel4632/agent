/*
配置 HTTP 插件：读取脱敏配置、保存配置草稿并测试已保存提供商连接。
脱敏属于 HTTP 输出边界，真实运行配置始终留在 Config 指令和 store 内。
调用示例：new Elysia().use(configRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合的路由插件能力
import { Config } from '../commands/config.js'        // 引入配置读取、更新和连接测试指令
import { Agent } from '../commands/agent.js'          // 引入配置更新后的 Agent 目录重载指令
import { Responses } from '../responses.js'           // 引入统一 Command 响应转换器
import { Schemas } from '../schemas.js'               // 引入配置请求命名模型


export const configRoutes = new Elysia({ name: 'agent.routes.config' }) // 配置 API 保留根级兼容路径
  .use(Schemas)                                        // 继承集中注册的请求模型
  .get('/config', () => Config.getPublic())            // 返回脱敏后的设计配置
  .put(
    '/config',                                         // 保存并立即应用配置
    async ({ body }) => {
      return Agent.applyConfig(body)                    // 单一指令原子保存配置并刷新 Agent 目录
    },
    { body: 'ConfigUpdate' },
  )
  .patch(
    '/config',                                         // 设计契约使用 PATCH 保存局部配置
    async ({ body }) => {
      return Agent.applyConfig(body)                   // 单一指令原子保存配置并刷新 Agent 目录
    },
    { body: 'ConfigUpdate' },
  )
  .post(
    '/config/test',                                    // 测试已保存认证的最小请求
    async ({ body }) => Responses.command(await Config.testProvider(body.provider, body.model)),
    { body: 'ConfigTest' },
  )
  .post(
    '/config/models',                                  // 从已保存供应商读取真实模型目录
    async ({ body }) => Responses.command(await Config.listModels(body.provider)),
    { body: 'ConfigModels' },
  )
