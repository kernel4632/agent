/* 唯一 Agent 循环：上下文 -> 模型 -> 并行工具 -> 下一轮模型。 */
import { getToolName, isToolUIPart } from 'ai'
import Store from '../store.js'
import LLM from '../utils/llm.js'
import Retry from '../utils/retry.js'
import Tool from '../utils/tool.js'
import Context from './context.js'
import Permission from './permission.js'
import Checkpoint from './checkpoint.js'
import Plugin from './plugin.js'

const run = async sessionID => {
    const session = Store.sessions[sessionID], runtime = Store.runtimes[sessionID]
    const provider = Store.config.providers.find(item => item.name === session.provider)
    const model = provider?.models.find(item => item.id === session.model)
    const signal = runtime.abortController.signal
    let idle = 0, reason = 'idle'

    try {
        if (!provider || !model) throw new Error('Session model is not configured')
        await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'running' } })
        await Plugin.emit('loop.start', { sessionID })

        while (!signal.aborted) {
            // 达到阈值时追加摘要，原始消息仍完整保存在 JSONL。
            const latestSummary = session.messages.findLastIndex(message => message.summary)
            if ((latestSummary < 0 || latestSummary < session.messages.length - 3)
                && Context.count(session.messages) > model.contextWindow * Store.config.context.compactRatio) {
                const context = await Context.build(sessionID)
                const result = await LLM.stream({
                    provider, model, ...context, instructions: Store.config.prompts.summary, signal,
                })
                const summary = { ...result.message, summary: true, usage: result.usage }
                session.messages.push(summary)
                await Store.save(sessionID)
                await Plugin.emit('message.append', { sessionID, message: summary })
                await Store.broadcast(sessionID, { type: 'data-compact', data: { message: summary } })
            }

            // 模型增量同时进入 SSE 缓存和插件钩子。
            const context = await Context.build(sessionID)
            const request = await Plugin.emit('request.before', { sessionID, ...context })
            const result = await LLM.stream({ provider, model, ...request, signal }, {
                receive: part => Promise.all([Store.broadcast(sessionID, part),
                    Plugin.emit('part.stream', { sessionID, part })]),
            })
            const message = { ...result.message, usage: result.usage }
            session.messages.push(message)
            await Store.save(sessionID)
            await Store.broadcast(sessionID, { type: 'data-message', data: { message } })

            // 一条助手消息中的所有工具调用并行等待审批和执行。
            const stopped = (await Promise.all(message.parts.map(async (part, partIndex) => {
                if (!isToolUIPart(part) || part.state !== 'input-available') return false
                const name = getToolName(part)
                try {
                    const allowed = await Permission.request(sessionID, part.toolCallId, name, part.input)
                    if (!allowed) {
                        Object.assign(part, { state: 'output-denied' })
                        await Store.broadcast(sessionID, { type: 'tool-output-denied', toolCallId: part.toolCallId })
                        return false
                    }
                    const before = await Plugin.emit('tool.before', { sessionID, tool: name, input: part.input })
                    const output = await Tool.execute(name, before.input, {
                        sessionID, messageID: message.id, partIndex, signal, tools: context.tools,
                        receive: event => Store.broadcast(sessionID, {
                            type: 'data-tool-output', data: { callID: part.toolCallId, tool: name, ...event },
                        }),
                        checkpoint: path => Checkpoint.save(sessionID, { messageID: message.id, partIndex }, path),
                        retry: operation => Retry.run(operation, signal),
                    })
                    Object.assign(part, { state: 'output-available', output: output.output })
                    await Store.broadcast(sessionID, {
                        type: 'tool-output-available', toolCallId: part.toolCallId, output: output.output,
                    })
                    await Plugin.emit('tool.after', {
                        sessionID, tool: name, input: before.input, output: output.output,
                    })
                    return output.stop === true
                } catch (error) {
                    Object.assign(part, { state: 'output-error', errorText: String(error) })
                    await Store.broadcast(sessionID, {
                        type: 'tool-output-error', toolCallId: part.toolCallId, errorText: String(error),
                    })
                } finally {
                    await Store.save(sessionID)
                }
            }))).some(Boolean)
            idle = message.parts.some(isToolUIPart) ? 0 : idle + 1
            await Plugin.emit('message.append', { sessionID, message })

            if (stopped) {
                reason = 'tool'
                break
            }
            if (Store.config.context.idleRounds > 0 && idle >= Store.config.context.idleRounds) break
        }
        if (signal.aborted) reason = 'abort'
    } catch (error) {
        reason = signal.aborted ? 'abort' : 'error'
        if (reason === 'error') await Store.broadcast(sessionID, { type: 'error', errorText: String(error) })
    } finally {
        await Plugin.emit('loop.end', { sessionID, reason }).catch(() => {})
        if (Store.runtimes[sessionID] === runtime && runtime.abortController.signal === signal) {
            runtime.status = 'idle'
            await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason } })
        }
    }
}

export default { run }
