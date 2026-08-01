/*
配置 HTTP 插件：读取脱敏配置、保存配置草稿并测试已保存提供商连接。
脱敏属于 HTTP 输出边界，真实运行配置始终留在 Config 指令和 store 内。
调用示例：new Elysia().use(configRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合的路由插件能力
import { Config } from '../commands/config.js'        // 引入配置读取、更新和连接测试指令
import { Skill } from '../commands/skills.js'         // 引入配置更新后的 Skill 重载指令
import { Schemas } from '../schemas.js'               // 引入配置请求命名模型


export const configRoutes = new Elysia({ name: 'agent.routes.config' }) // 配置 API 保留根级兼容路径
  .use(Schemas)                                        // 继承集中注册的请求模型
  .get('/config', () => Config.getPublic())            // 返回脱敏后的设计配置
  .patch(
    '/config',                                         // 设计契约使用 PATCH 保存局部配置
    async ({ body }) => {
      const result = await Config.update(body)         // 配置先原子持久化
      if (!result.ok) return result                     // 保存失败不刷新运行时能力
      await Promise.all([Skill.reload(), Config.reloadMCP()]) // 保存成功后更新外部能力
      return result                                     // 向 HTTP 入口反馈保存结果
    },
    { body: 'ConfigUpdate' },
  )
