/*
健康检查 HTTP 入口：接收服务探测并返回架构要求的引擎版本。
该入口不读取业务 Store，也不执行资源初始化，保证故障诊断路径始终简单。
调用示例：new Elysia().use(healthRoutes)。
*/
import { Elysia } from 'elysia' // 引入可组合 HTTP 路由能力


export const healthRoutes = new Elysia({ name: 'agent.routes.health' }) // 健康检查使用独立设计模块
  .get('/health', () => ({ ok: true, service: 'agent-server', version: '0.1.0', engine: { version: '0.1.0' } })) // 反馈服务和引擎版本
