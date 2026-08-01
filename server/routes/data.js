/*
数据 HTTP 插件：接收设置页导出、导入和清理触发，并调用 Data 指令。
入口只转换 HTTP 请求与响应，不直接访问配置文件、工作区或会话存储。
调用示例：new Elysia().use(dataRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合 HTTP 路由能力
import { Data } from '../commands/data.js'            // 引入数据备份业务动作
import { Responses } from '../responses.js'           // 引入指令结果响应转换


export const dataRoutes = new Elysia({ name: 'agent.routes.data', prefix: '/data' }) // 数据管理使用独立资源路径
  .get('', () => Data.exportBackup())                   // 下载完整 JSON 备份
  .post('', async ({ body }) => Responses.command(await Data.importBackup(body))) // 导入并验证完整备份
  .delete('', async () => Responses.command(await Data.clear())) // 清除会话和工作区索引
