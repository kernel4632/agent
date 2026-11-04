/*
 * 工具计时账本：按 toolCallId 记录开始/结束时间，独立于会话历史落盘。
 *
 * 为什么单独存：工具可能在一次运行中途被刷新页面，这时历史还没有走完一步，
 * 但计时不能从页面刷新重新算。账本在 tool-call 事件发生时立刻写入，刷新后由
 * /session/read 一起返回，前端按同一份时间恢复。
 *
 * 并发工具会同时 start，写文件用会话级队列串行化，避免后写覆盖先写。
 * 调用示例：await ToolTiming.start({ sessionId, toolCallId })
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import Path from '../utils/path.js'

const cache = new Map()
const queues = new Map()

const readFileState = async sessionId => {
    try {
        return JSON.parse(await readFile(Path.toolTimings(sessionId), 'utf8'))
    } catch {
        return {}
    }
}

const stateOf = async sessionId => {
    if (!cache.has(sessionId)) cache.set(sessionId, await readFileState(sessionId))
    return cache.get(sessionId)
}

const persist = async (sessionId, state) => {
    await mkdir(Path.session(sessionId), { recursive: true })
    const file = Path.toolTimings(sessionId)
    const temporary = `${file}.tmp`
    await writeFile(temporary, JSON.stringify(state, null, 2))
    await rename(temporary, file)
}

// 同一条会话的读写排成一队：并行工具不会互相覆盖。
const enqueue = (sessionId, task) => {
    const previous = queues.get(sessionId) || Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    queues.set(sessionId, next)
    return next.finally(() => {
        if (queues.get(sessionId) === next) queues.delete(sessionId)
    })
}

export const start = ({ sessionId, toolCallId, at = Date.now() }) => {
    if (!sessionId || !toolCallId) return Promise.resolve(null)
    return enqueue(sessionId, async () => {
        const state = await stateOf(sessionId)
        state[toolCallId] = { startedAt: at }
        await persist(sessionId, state)
        return state[toolCallId]
    })
}

export const finish = ({ sessionId, toolCallId, at = Date.now() }) => {
    if (!sessionId || !toolCallId) return Promise.resolve(null)
    return enqueue(sessionId, async () => {
        const state = await stateOf(sessionId)
        const previous = state[toolCallId] || {}
        const startedAt = Number(previous.startedAt || 0)
        state[toolCallId] = {
            startedAt,
            finishedAt: at,
            durationMs: startedAt ? Math.max(0, at - startedAt) : 0,
        }
        await persist(sessionId, state)
        return state[toolCallId]
    })
}

export const read = async sessionId => ({ ...(await stateOf(sessionId)) })

export const forget = sessionId => {
    cache.delete(sessionId)
    queues.delete(sessionId)
}

export default { start, finish, read, forget }
