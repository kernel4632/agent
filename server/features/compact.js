/* 压缩只追加摘要消息，原始历史始终保留。 */
import Store from '../store.js'
import LLM from '../utils/llm.js'
import Context from './context.js'
import Plugin from './plugin.js'

const run = async sessionID => {
    const session = Store.sessions[sessionID]
    const runtime = Store.runtimes[sessionID]
    if (runtime.status === 'running') throw new Error('Cannot compact a running session')

    const provider = Store.config.providers.find(item => item.name === session.provider)
    const model = provider?.models.find(item => item.id === session.model)
    if (!provider || !model) throw new Error('Session model is not configured')

    runtime.status = 'running'
    runtime.abortController = new AbortController()

    try {
        await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'running' } })
        const context = await Context.build(sessionID)
        const result = await LLM.stream({
            provider,
            model,
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
        runtime.status = 'idle'
        await Store.broadcast(sessionID, {
            type: 'data-status',
            data: { status: 'idle', reason: 'compact' },
        })
    }
}

export default { run }
