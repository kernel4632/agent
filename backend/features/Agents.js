/*
Agent 实例：创建、读取、发送、停止、压缩、换模型、截断历史。
agent-core 是唯一循环、唯一写历史的；这里只装配实例，把 core 事件原样交给 Stream，把 message 交给 Store 落盘。
同一会话一次只跑一件事，正在跑时再 send / compact 抛 status 409。进程重启后不自动续跑。
send / compact 在任务开始后立刻返回，调用方用 Agents.done(id) 等待结束。
*/

import { Agent } from '@kernel4632/agent-core'
import { Store } from './Store.js'
import { Models } from './Models.js'
import { Stream } from './Stream.js'

const agents = new Map()
const jobs = new Map()
const reserved = new Set()

function busy() {
    const error = new Error('正在运行')
    error.status = 409
    throw error
}

function idle(id) {
    if (jobs.has(id) || reserved.has(id)) busy()
}

function rest(config) {
    const { providers, models, ...shared } = config
    return shared
}

async function options(meta, config) {
    const modelId = meta.model || config.models?.chat
    const resolved = Models.resolve(config, modelId, meta.effort)
    const compactId = config.models?.compact
    const compact = compactId ? Models.resolve(config, compactId) : undefined
    return { ...rest(config), ...resolved, ...(compact ? { compact } : {}), contextRatio: meta.contextRatio, ratios: meta.ratios ?? {} }
}

async function launch(id, work) {
    const { agent } = await Agents.open(id)
    const job = (async () => {
        Stream.emit(id, 'run', { state: 'start' })
        try {
            const answer = await work(agent)
            Stream.emit(id, 'run', { state: 'end', answer })
            return answer
        } catch (error) {
            Stream.emit(id, 'run', error.kind === 'aborted' ? { state: 'stopped' } : { state: 'error', message: error.message ?? String(error) })
            throw error
        } finally { jobs.delete(id) }
    })()
    jobs.set(id, job)
    job.catch(() => {})                                                 // 避免 stop 之后任务从 jobs 里摘掉时变成未处理拒绝
}

export const Agents = {
    async open(id) {
        const hit = agents.get(id)
        if (hit) return hit
        await Store.ensure(id)
        const [config, meta, history] = await Promise.all([Store.config(), Store.meta(id), Store.history(id)])
        const agent = Agent.create({ id, history, ...await options(meta, config) })
        const current = { agent, model: meta.model || config.models?.chat, effort: meta.effort, models: Models.list(config) }
        agents.set(id, current)
        return current
    },

    peek(id) { return agents.get(id) },
    done(id) { return jobs.get(id) ?? Promise.resolve() },
    running(id) { return jobs.has(id) || reserved.has(id) },

    // 快照是同步的：调用方必须先 open，再在同一同步步骤里 subscribe + snapshot。
    snapshot(id) {
        const current = agents.get(id)
        if (!current) throw new Error(`Agent ${id} 尚未打开`)
        return { history: current.agent.history, tail: Stream.tail(id), running: Agents.running(id), retryUntil: Stream.retry(id), model: current.model, effort: current.effort, models: current.models }
    },

    callbacks(id) {
        return {
            onEvent(event) {
                const written = event.type === 'message' ? Store.append(id, event.message) : undefined
                Stream.feed(id, event)
                return written
            },
        }
    },

    async send(id, { input, cut } = {}) {
        idle(id)
        reserved.add(id)
        try {
            if (cut) await Agents.cut(id, cut, true)
            await launch(id, agent => agent.send(input, Agents.callbacks(id)))
            reserved.delete(id)
        } catch (error) {
            reserved.delete(id)
            throw error
        }
    },

    async compact(id) {
        idle(id)
        reserved.add(id)
        try {
            await launch(id, agent => agent.compact(Agents.callbacks(id)))
            reserved.delete(id)
        } catch (error) {
            reserved.delete(id)
            throw error
        }
    },

    async stop(id) {
        const current = await Agents.open(id)
        const result = await current.agent.stop()
        await Agents.done(id).catch(() => {})
        return result
    },

    async configure(id, { model, effort } = {}) {
        const current = await Agents.open(id)
        const config = await Store.config()
        const meta = await Store.touch(id, { ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}) })
        current.model = meta.model || current.model
        current.effort = meta.effort
        current.models = Models.list(config)
        current.agent.config = { ...current.agent.config, ...Models.resolve(config, current.model, current.effort) }
        return { model: current.model, effort: current.effort }
    },

    // 把历史截到这条消息之前（含它自己），并整份重写 jsonl。held 表示调用方已经占住运行锁（send 里改写重发）。
    async cut(id, messageId, held = false) {
        if (!held) idle(id)
        const current = await Agents.open(id)
        const index = current.agent.history.findIndex(message => message.id === messageId)
        if (index < 0) { const error = new Error(`找不到消息 ${messageId}`); error.status = 404; throw error }
        current.agent.history.splice(index)
        Stream.clear(id)
        await Store.write(id, current.agent.history)
        Stream.emit(id, 'cut', { history: current.agent.history })
    },

    // 丢掉内存里的实例，下次 open 从磁盘再读（测试或配置重载用）。
    drop(id) {
        agents.delete(id)
        jobs.delete(id)
        reserved.delete(id)
        Stream.clear(id)
    },
}
