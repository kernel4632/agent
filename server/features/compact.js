/* 摘要只追加新消息，原始历史始终保留在 JSONL 中。 */
import { convertToModelMessages } from 'ai'
import Store from '../store.js'
import Session from '../commands/session.js'
import LLM from '../utils/llm.js'
import Plugin from './plugin.js'

const run = async sessionID => {
    const session = Store.sessions[sessionID]
    const runtime = Store.runtimes[sessionID]
    const standalone = runtime.status === 'idle'
    if (standalone) {
        runtime.status = 'running'
        runtime.abortController = new AbortController()
        await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'running' } })
    }
    const provider = Store.config.providers.find(item => item.name === session.provider)
    const model = provider?.models.find(item => item.id === session.model)
    if (!provider || !model) throw new Error('Session model is not configured')
    try {
        const result = await LLM.stream({
            provider, model,
            messages: await convertToModelMessages(session.messages, { ignoreIncompleteToolCalls: true }),
            instructions: Store.config.prompts.summary,
            signal: runtime.abortController.signal,
        })
        const summary = { ...result.message, summary: true, usage: result.usage }
        await Session.append(sessionID, summary)
        await Plugin.emit('message.append', { sessionID, message: summary })
        await Store.broadcast(sessionID, { type: 'data-compact', data: { message: summary } })
        return summary
    } finally {
        if (standalone) {
            runtime.status = 'idle'
            await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason: 'compact' } })
        }
    }
}

export default { run }
