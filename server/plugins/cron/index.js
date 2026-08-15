/* 定时任务只调用公开 Agent.send，不进入内核私有状态。 */
import { Cron } from 'croner' // 使用成熟 cron 解析和定时能力。

export default api => {
    const jobs = api.Store.config.plugins.cron?.settings?.jobs || [] // 读取用户声明的定时任务。
    const running = [] // 保存 timer，卸载时必须全部停止。

    for (const job of jobs) {
        const timer = new Cron(job.cron, { timezone: job.timezone }, () => { // 在任务时区触发。
            void api.Agent.send(job.sessionID, job.message).catch(() => {}) // 只调用公开 Agent API。
        })
        running.push(timer) // 记录 timer 以便插件卸载时释放。
    }

    return { name: 'cron', unload: () => running.forEach(job => job.stop()) } // 删除插件立即停止所有任务。
}
