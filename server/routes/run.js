/*
Run HTTP 插件：查询会话执行树和停止指定 Run，HTTP 断开不会自动改变后台 Run 的生命周期。
真正的模型执行仍由 Chat 指令负责，路由只调用 Run 查询和取消动作。
调用示例：new Elysia().use(runRoutes)。
*/
import { Elysia } from 'elysia'                         // 引入可组合的 Elysia 路由能力
import { Run } from '../commands/run.js'                 // 引入 Run 查询和取消指令


export const runRoutes = new Elysia({ name: 'agent.routes.run' }) // Run API 保留资源级路径
  .get('/session/:id/runs', ({ params }) => Run.listForSession(params.id)) // 返回会话根 Run 和子 Run
  .get('/run/:id', ({ params }) => {
    const run = Run.get(params.id)                       // 读取内部 Run 并去除取消控制器
    return run ? Run.toPublicRun(run) : Response.json({ error: 'run not found' }, { status: 404 }) // 不存在时反馈资源错误
  })
  .post('/run/:id/stop', ({ params }) => Run.cancel(params.id)) // 取消目标 Run 及其全部子 Run
