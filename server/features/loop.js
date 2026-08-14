/* 线性主循环：上下文 -> 模型 -> 并行工具，直到明确停止。 */
import { getToolName, isToolUIPart } from 'ai'
import Store from '../store.js'
import LLM from '../utils/llm.js'
import Retry from '../utils/retry.js'
import Tool from '../utils/tool.js'
import Context from './context.js'
import Compact from './compact.js'
import Permission from './permission.js'
import Checkpoint from './checkpoint.js'
import Plugin from './plugin.js'

const run = async sessionID => {
    const session = Store.sessions[sessionID]
    const runtime = Store.runtimes[sessionID]
    const runID = crypto.randomUUID()
    runtime.runID = runID
    const provider = Store.config.providers.find(item => item.name === session.provider)
    const model = provider?.models.find(item => item.id === session.model)
    let idle = 0
    let reason = 'idle'
    try {
        if (!provider || !model) throw new Error('Session model is not configured')
        await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'running' } })
        await Plugin.emit('loop.start', { sessionID })
        while (!runtime.abortController.signal.aborted) {
            if (Context.count(session.messages) > model.contextWindow * Store.config.context.compactRatio) await Compact.run(sessionID, true)
            const context = await Context.build(sessionID)
            const request = await Plugin.emit('request.before', { sessionID, ...context })
            const result = await LLM.stream({ provider, model, ...request, signal: runtime.abortController.signal }, {
                receive: async part => {
                    await Store.broadcast(sessionID, part)
                    await Plugin.emit('part.stream', { sessionID, part })
                },
            })
            const message = { ...result.message, usage: result.usage }
            session.messages.push(message)
            await Store.save(sessionID)
            await Store.broadcast(sessionID, { type: 'data-message', data: { message } })
            const calls = message.parts.map(async (part, partIndex) => {
                if (!isToolUIPart(part) || part.state !== 'input-available') return false
                const name = getToolName(part)
                try {
                    if (!await Permission.request(sessionID, part.toolCallId, name, part.input)) {
                        Object.assign(part, { state: 'output-denied' })
                        await Store.broadcast(sessionID, { type: 'tool-output-denied', toolCallId: part.toolCallId })
                        return false
                    }

                    const input = (await Plugin.emit('tool.before', { sessionID, tool: name, input: part.input })).input
                    const output = await Tool.execute(name, input, {
                        tools: context.available, sessionID, messageID: message.id, partIndex,
                        signal: runtime.abortController.signal,
                        processes: runtime.processes,
                        receive: event => Store.broadcast(sessionID, { type: 'data-tool-output', data: { callID: part.toolCallId, tool: name, ...event } }),
                        checkpoint: path => Checkpoint.save(sessionID, { messageID: message.id, partIndex }, path),
                        retry: operation => Retry.run(operation, runtime.abortController.signal),
                    })
                    Object.assign(part, { state: 'output-available', output: output.output })
                    await Store.broadcast(sessionID, { type: 'tool-output-available', toolCallId: part.toolCallId, output: output.output })
                    await Plugin.emit('tool.after', { sessionID, tool: name, input, output: output.output })
                    return output.stop === true
                } catch (error) {
                    Object.assign(part, { state: 'output-error', errorText: String(error) })
                    await Store.broadcast(sessionID, { type: 'tool-output-error', toolCallId: part.toolCallId, errorText: String(error) })
                    return false
                } finally { await Store.save(sessionID) }
            })
            const stopped = (await Promise.all(calls)).some(Boolean)
            idle = message.parts.some(isToolUIPart) ? 0 : idle + 1
            await Plugin.emit('message.append', { sessionID, message })
            if (stopped) { reason = 'tool'; break }
            if (Store.config.context.idleRounds > 0 && idle >= Store.config.context.idleRounds) throw new Error(`Model was idle for ${idle} rounds`)
        }
        if (runtime.abortController.signal.aborted) reason = 'abort'
    } catch (error) {
        reason = runtime.abortController.signal.aborted ? 'abort' : 'error'
        if (reason === 'error') await Store.broadcast(sessionID, { type: 'error', errorText: String(error) })
    } finally {
        if (runtime.runID === runID) {
            await Plugin.emit('loop.end', { sessionID, reason }).catch(() => {})
            await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason } })
            runtime.status = 'idle'
            runtime.events = []
        }
    }
}

export default { run }
