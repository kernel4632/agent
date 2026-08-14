/* 摘要只追加新消息，原始历史始终保留在 JSONL 中。 */
import Store from '../store.js'
import LLM from '../utils/llm.js'
import Plugin from './plugin.js'
import Context from './context.js'

const runNow = async (sessionID, internal) => {
    const session = Store.sessions[sessionID]
    const runtime = Store.runtimes[sessionID]
    if (runtime.status === 'running' && !internal) throw new Error('Cannot compact a running session')
    const standalone = !internal
    const provider = Store.config.providers.find(item => item.name === session.provider)
    const model = provider?.models.find(item => item.id === session.model)
    if (!provider || !model) throw new Error('Session model is not configured')
    if (standalone) {
        runtime.status = 'running'
        runtime.abortController = new AbortController()
        await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'running' } })
    }
    try {
        const context = await Context.build(sessionID)
        const result = await LLM.stream({
            provider, model,
            messages: context.messages,
            tools: context.tools,
            instructions: Store.config.prompts.summary,
            signal: runtime.abortController.signal,
        })
        const summary = { ...result.message, summary: true, usage: result.usage }
        session.messages.push(summary)
        await Store.save(sessionID)
        await Plugin.emit('message.append', { sessionID, message: summary })
        await Store.broadcast(sessionID, { type: 'data-compact', data: { message: summary } })
        return summary
    } finally {
        if (standalone) {
            await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason: 'compact' } })
            runtime.status = 'idle'
        }
    }
}

const run = (sessionID, internal = false) => {
    if (internal) return runNow(sessionID, true)

    const runtime = Store.runtimes[sessionID]
    if (runtime.status === 'running') throw new Error('Cannot compact a running session')

    const task = runNow(sessionID, false)
    runtime.compactTask = task
    const cleanup = task.finally(() => { if (runtime.compactTask === cleanup) delete runtime.compactTask })
    cleanup.catch(() => {})
    return task
}

export default { run }
