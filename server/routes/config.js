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


// --- 隐藏配置中的认证信息 ---
function redact(config) {
  const safeConfig = structuredClone(config)           // 脱敏副本不能修改模型实际使用的配置
  for (const provider of Object.values(safeConfig.providers ?? {})) {
    if (provider && 'apiKey' in provider) provider.apiKey = provider.apiKey ? '[REDACTED]' : provider.apiKey // API Key 只反馈是否存在
    for (const header of Object.keys(provider?.headers ?? {})) {
      if (/authorization|api[-_]?key|token|cookie|secret/i.test(header) && provider.headers[header]) provider.headers[header] = '[REDACTED]' // 认证请求头不返回明文
    }
  }
  for (const server of Object.values(safeConfig.mcpServers ?? {})) {
    for (const field of ['headers', 'env']) {
      for (const key of Object.keys(server?.[field] ?? {})) {
        if (/authorization|api[-_]?key|token|cookie|secret|password/i.test(key) && server[field][key]) server[field][key] = '[REDACTED]' // MCP 认证和进程密钥使用同一规则
      }
    }
  }
  return safeConfig                                    // 返回可以安全展示给设置页的副本
}


export const configRoutes = new Elysia({ name: 'agent.routes.config' }) // 配置 API 保留根级兼容路径
  .use(Schemas)                                        // 继承集中注册的请求模型
  .get('/config', () => redact(Config.get()))          // 返回脱敏后的当前配置
  .put(
    '/config',                                         // 保存并立即应用配置
    async ({ body }) => {
      const result = await Config.update(body)           // 先持久化共享配置和 Agent 定义
      await Agent.load()                                // 让后续 Run 立即看到最新 Agent 选择
      return result                                     // 返回配置更新结果
    },
    { body: 'ConfigUpdate' },
  )
  .patch(
    '/config',                                         // 设计契约使用 PATCH 保存局部配置
    async ({ body }) => {
      const result = await Config.update(body)         // 先持久化配置数据
      await Agent.load()                               // 再让后续 Run 使用最新 Agent 目录
      return result                                    // 反馈配置保存完成
    },
    { body: 'ConfigUpdate' },
  )
  .post(
    '/config/test',                                    // 测试已保存认证的最小请求
    async ({ body }) => Responses.command(await Config.testProvider(body.provider, body.model)),
    { body: 'ConfigTest' },
  )
