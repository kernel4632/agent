/*
定时任务插件：读取插件 settings.jobs，到点后只调用公开的 Agent.send。
*/
import { Cron } from 'croner'
import type { PluginModule } from '../../types.ts'

export default (api: any): PluginModule => {
    const jobs = (api.Store.config.plugins.cron?.settings as any)?.jobs ?? []
    const running = jobs.map((job: any) => new Cron(job.cron, { timezone: job.timezone }, () => {
        void Promise.resolve(api.Agent.send(job.sessionID, job.message)).catch(() => undefined)
    }))
    return { name: 'cron', unload: () => running.forEach((job: Cron) => job.stop()) }
}
