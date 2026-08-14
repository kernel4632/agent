/* 定时任务只调用公开 Agent.send，不进入内核私有状态。 */
import { Cron } from 'croner'

export default api => {
    const jobs = api.Store.config.plugins.cron?.settings?.jobs || []
    const running = []
    try {
        for (const job of jobs) running.push(new Cron(job.cron, { timezone: job.timezone }, () => {
            void api.Agent.send(job.sessionID, job.message).catch(() => {})
        }))
    } catch (error) {
        running.forEach(job => job.stop())
        throw error
    }
    return { name: 'cron', unload: () => running.forEach(job => job.stop()) }
}
