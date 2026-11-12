/*
 * 监控调度与唤醒引擎：管理监控条目、驱动后台轮询、在条件达成时安全唤醒会话。
 *
 * 核心原则：
 * 1. 全程不打断：会话 running 为 true 时绝不强行并发调 Chat.send，而是排队等它空闲。
 * 2. 状态一个来源：每个会话的监控持久化在 session 目录下的 monitors.json。
 * 3. 干净可插拔：服务关闭或扩展停用时，clearInterval 收掉后台心跳。
 *
 * 调用示例：
 *   await MonitorEngine.start()
 *   await MonitorEngine.arm({ sessionId, condition: { kind: 'timer', afterSeconds: 10 }, objective: '...' })
 *   await MonitorEngine.stop()
 */

import { join } from 'node:path'
import store from '@agent/store.js'
import Chat from '@agent/commands/chat.js'
import History from '@agent/features/history.js'
import Path from '@agent/utils/path.js'

import ProcessCondition from './conditions/process.js'
import FileCondition from './conditions/file.js'
import TimerCondition from './conditions/timer.js'
import CommandCondition from './conditions/command.js'
import buildNotice from './notice.js'

// 条件插件字典（加条件只动 conditions/ 目录并在此登记）
const conditions = {
    process: ProcessCondition,
    file: FileCondition,
    timer: TimerCondition,
    command: CommandCondition,
}

// 内存中活跃的所有监控：id -> record
const records = new Map()                      // 记录表
let timer = null                               // 调度器 interval 句柄
let nextIdNum = 1                              // m1, m2...
let isTicking = false                          // 防重叠锁

const monitorFilePath = sessionId => join(Path.sessions(), sessionId, 'monitors.json')

// --- 保存单条会话的监控列表到磁盘 ---
const saveSessionMonitors = async sessionId => {
    const list = [...records.values()].filter(m => m.sessionId === sessionId)
    const file = monitorFilePath(sessionId)
    try {
        await Bun.write(file, JSON.stringify(list, null, 2))
    } catch (error) {
        console.error(`[monitor] 会话 ${sessionId} 监控持久化失败: ${error.message}`)
    }
}

// --- 唤醒会话或插入消息 ---
const triggerWake = async monitor => {
    const { sessionId, objective, rounds, condition, wake } = monitor
    const condMod = conditions[condition.kind]
    const condDesc = condMod ? condMod.describe(condition) : condition.kind

    const noticeText = buildNotice({
        objective,
        round: rounds.used,
        maxRounds: rounds.max,
        conditionDesc: condDesc,
        evidence: monitor.lastEvidence || '',
        wake,
    })

    // 仅插入上下文模式
    if (wake === 'inject') {
        const message = {
            id: crypto.randomUUID().slice(0, 8),
            role: 'user',
            content: noticeText,
            timestamp: Date.now(),
        }
        await History.add({ sessionId, message }).catch(() => {})
        await History.save(sessionId).catch(() => {})
        return
    }

    // wake 唤醒模式：必须等到会话空闲才能触发 Chat.send
    const session = store.sessions[sessionId]
    if (session?.running) {
        // 当前仍有任务在跑，标记为 pending_wake，绝不打断当前代理，等下一轮 tick 检测到空闲后再发
        monitor.status = 'pending_wake'
        return
    }

    // 空闲态直接调用 Chat.send 启动新一轮模型推理！
    try {
        monitor.status = monitor.rounds.used >= monitor.rounds.max ? 'done' : 'armed'
        // 异步发出，不阻塞调度循环
        void Chat.send({ sessionId, input: noticeText }).catch(err => {
            console.error(`[monitor] 会话 ${sessionId} 唤醒失败: ${err.message}`)
        })
    } catch (error) {
        console.error(`[monitor] 触发 Chat.send 出错: ${error.message}`)
    }
}

// --- 调度器心跳 ---
const tick = async () => {
    if (isTicking) return
    isTicking = true

    try {
        const now = Date.now()

        for (const monitor of records.values()) {
            // 处理之前因为会话忙碌而排队的唤醒请求
            if (monitor.status === 'pending_wake') {
                const session = store.sessions[monitor.sessionId]
                if (!session?.running) {
                    await triggerWake(monitor)
                    await saveSessionMonitors(monitor.sessionId)
                }
                continue
            }

            if (monitor.status !== 'armed') continue

            // 超时淘汰 (TTL)
            if (now >= monitor.expiresAt) {
                monitor.status = 'expired'
                await saveSessionMonitors(monitor.sessionId)
                continue
            }

            // 尚未到达下次检查时间
            if (now < monitor.nextCheckAt) continue

            const condMod = conditions[monitor.condition.kind]
            if (!condMod) continue

            monitor.lastCheckedAt = now
            const session = store.sessions[monitor.sessionId]
            const cwd = session?.cwd || process.cwd()

            try {
                const result = await condMod.check(monitor.condition, monitor.conditionState, { cwd })

                if (result.error) {
                    monitor.errorCount = (monitor.errorCount || 0) + 1
                    monitor.lastError = result.error
                    if (monitor.errorCount >= 3) {
                        monitor.status = 'error'       // 连续 3 次失败自动熔断
                        await saveSessionMonitors(monitor.sessionId)
                    } else {
                        monitor.nextCheckAt = now + Math.min(60, Math.pow(2, monitor.errorCount)) * 1000
                    }
                } else {
                    monitor.errorCount = 0
                    if (result.state) monitor.conditionState = result.state

                    if (result.fired) {
                        monitor.rounds.used++
                        monitor.lastFiredAt = now
                        monitor.lastEvidence = result.evidence || ''

                        // 判断是否终结
                        if (!monitor.repeat || monitor.rounds.used >= monitor.rounds.max) {
                            monitor.status = 'done'
                        } else {
                            monitor.status = 'armed'
                            monitor.nextCheckAt = now + monitor.cooldownSeconds * 1000
                        }

                        await triggerWake(monitor)
                        await saveSessionMonitors(monitor.sessionId)
                    } else {
                        monitor.nextCheckAt = result.nextCheckAt || (now + 1000)
                    }
                }
            } catch (err) {
                monitor.errorCount = (monitor.errorCount || 0) + 1
                monitor.lastError = err.message
                if (monitor.errorCount >= 3) monitor.status = 'error'
            }
        }
    } finally {
        isTicking = false
    }
}

const MonitorEngine = {
    // --- 启动调度器 ---
    start() {
        if (timer) return
        timer = setInterval(tick, 1000)
        timer.unref?.()                        // 不阻碍进程正常退出
    },

    // --- 停止调度器 ---
    stop() {
        if (!timer) return
        clearInterval(timer)
        timer = null
        records.clear()
    },

    // --- 挂载监控 ---
    async arm({
        sessionId,
        condition = {},
        objective = '',
        name = '',
        rounds = 20,
        repeat = true,
        cooldownSeconds = 30,
        ttlSeconds = 3600,
        wake = 'wake',
        key = '',
    } = {}, { cwd = process.cwd() } = {}) {
        if (!sessionId) throw new Error('sessionId is required')
        const cleanObjective = String(objective || '').trim()
        if (!cleanObjective) throw new Error('objective 是必填项，请指明唤醒后需要推进的具体任务目标')

        const kind = String(condition.kind || '').toLowerCase()
        const condMod = conditions[kind]
        if (!condMod) {
            const supported = Object.keys(conditions).join('/')
            throw new Error(`未知的监控条件类型 '${kind}'，必须是 ${supported} 之一`)
        }

        // 幂等 key 检查
        if (key) {
            const existing = [...records.values()].find(m => m.sessionId === sessionId && m.key === key && m.status === 'armed')
            if (existing) {
                return { monitor: existing, deduped: true }
            }
        }

        const spec = condMod.normalize(condition, { cwd })
        const initialState = await condMod.start(spec, { cwd })

        const id = `m${nextIdNum++}`
        const now = Date.now()
        const maxRounds = repeat ? Math.max(1, Math.min(100, Number(rounds || 20))) : 1

        const monitor = {
            id,
            sessionId,
            key: key || undefined,
            name: name ? String(name).trim() : undefined,
            objective: cleanObjective,
            condition: spec,
            conditionState: initialState,
            wake: wake === 'inject' ? 'inject' : 'wake',
            repeat: Boolean(repeat),
            rounds: { used: 0, max: maxRounds },
            cooldownSeconds: Math.max(1, Number(cooldownSeconds || 30)),
            ttlSeconds: Math.max(10, Number(ttlSeconds || 3600)),
            createdAt: now,
            expiresAt: now + (Number(ttlSeconds || 3600) * 1000),
            nextCheckAt: spec.kind === 'timer' ? now + (spec.afterSeconds * 1000) : now + 1000,
            status: 'armed',
            errorCount: 0,
        }

        records.set(id, monitor)
        await saveSessionMonitors(sessionId)
        return { monitor, deduped: false }
    },

    // --- 查看监控列表 ---
    list({ sessionId, includeEnded = false } = {}) {
        const list = []
        for (const m of records.values()) {
            if (sessionId && m.sessionId !== sessionId) continue
            if (!includeEnded && (m.status === 'done' || m.status === 'stopped' || m.status === 'expired')) continue

            const condMod = conditions[m.condition.kind]
            const desc = condMod ? condMod.describe(m.condition) : m.condition.kind

            list.push({
                id: m.id,
                key: m.key,
                status: m.status,
                name: m.name,
                objective: m.objective,
                summary: desc,
                rounds: `${m.rounds.used}/${m.rounds.max}`,
                expiresInSeconds: Math.max(0, Math.round((m.expiresAt - Date.now()) / 1000)),
                lastEvidence: m.lastEvidence,
                lastError: m.lastError,
            })
        }
        return list
    },

    // --- 停止监控 ---
    async stopMonitor({ sessionId, id, all = false } = {}) {
        const stopped = []
        for (const m of records.values()) {
            if (sessionId && m.sessionId !== sessionId) continue
            if (all || m.id === id) {
                if (m.status === 'armed' || m.status === 'pending_wake' || m.status === 'error') {
                    m.status = 'stopped'
                    stopped.push(m.id)
                }
            }
        }
        if (sessionId && stopped.length) {
            await saveSessionMonitors(sessionId)
        }
        return stopped
    },

    // --- 从指定会话加载历史监控记录 ---
    async loadSession(sessionId) {
        const file = Bun.file(monitorFilePath(sessionId))
        if (!await file.exists()) return
        try {
            const list = await file.json()
            if (!Array.isArray(list)) return
            for (const item of list) {
                if (item.id && !records.has(item.id)) {
                    // 若已超过 TTL，置为 expired
                    if (Date.now() >= item.expiresAt) item.status = 'expired'
                    records.set(item.id, item)
                    const num = parseInt(item.id.slice(1), 10)
                    if (!isNaN(num) && num >= nextIdNum) nextIdNum = num + 1
                }
            }
        } catch {}
    },
}

export default MonitorEngine
