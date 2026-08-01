/*
外部能力 HTTP 插件：汇总 MCP、LSP、Skills 和统一工具列表，并支持一次重载全部能力。
插件只编排独立指令，不管理连接、子进程或扫描状态。
调用示例：new Elysia().use(capabilityRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合的路由插件能力
import { Capability } from '../commands/capability.js' // 引入能力汇总和重载指令


export const capabilityRoutes = new Elysia({ name: 'agent.routes.capability', prefix: '/capability' }) // 能力 API 使用独立前缀插件
  .get('/list', () => Capability.list())                // 返回配置与运行状态快照
  .post('/reload', () => Capability.reload())           // 重建全部外部能力
