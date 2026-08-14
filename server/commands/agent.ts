/*
Agent 指令只有 send 与 stop：send 追加用户消息并启动循环，stop 中断当前请求和工具。
运行中再次 send 会先完整停止旧循环，再开始新消息，永远只有一个循环修改会话。
*/
import { nanoid } from 'nanoid'
import Plugin from '../features/plugin.ts'
import Compact from '../features/compact.ts'
import Context from '../features/context.ts'
import Permission from '../features/permission.ts'
import LLM from '../utils/llm.ts'
import Tool from '../utils/tool.ts'
import Store from '../store.ts'
import type { AgentMessage } from '../types.ts'
import Session from './session.ts'
import Error from '../utils/error.ts'
import { dynamicTool, getToolName, isToolUIPart, jsonSchema, type UIMessageChunk } from 'ai'

const stop = async (sessionID: string) => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime || runtime.status === 'idle') return false
    runtime.abort.abort(new DOMException('User cancelled.', 'AbortError'))
    runtime.tools.forEach(tool => tool.abort())
    runtime.permission.forEach(resolve => resolve({ action: 'deny', scope: 'once' }))
    await runtime.task
    return true
}

const send = async (sessionID: string, input: string | AgentMessage, onEvent?: (event: UIMessageChunk) => void | Promise<void>) => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime) throw Error.notFound('Session not found')
    const previous = runtime.lock
    let release = () => {}
    runtime.lock = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
        const session = Store.sessions[sessionID]
        if (!session) throw Error.notFound('Session not found')
        if (typeof input !== 'string' && (!input.id || !['user', 'assistant', 'system'].includes(input.role) || !Array.isArray(input.parts))) {
            throw Error.invalid('Invalid message')
        }
        if (typeof input !== 'string' && session.messages.some(message => message.id === input.id)) {
            throw Error.conflict(`Message already exists: ${input.id}`)
        }
        if (runtime.status === 'running') {
            runtime.abort.abort(new DOMException('User cancelled.', 'AbortError'))
            runtime.tools.forEach(tool => tool.abort())
            runtime.permission.forEach(resolve => resolve({ action: 'deny', scope: 'once' }))
            await runtime.task
        }

        const message: AgentMessage = typeof input === 'string' ? {
            id: nanoid(),
            role: 'user',
            createdAt: new Date().toISOString(),
            parts: [{ type: 'text', text: input }],
        } : input
        runtime.status = 'running'
        runtime.abort = new AbortController()
        const task = (async () => {
            let reason = 'error'
            try {
                await Session.append(sessionID, message)
                await Session.touch(sessionID)
                await Plugin.emit('message.append', { sessionID, message })
                await onEvent?.({ type: 'data-session-status', data: { status: 'running' }, transient: true })
                await Plugin.emit('loop.start', { sessionID })
                let idleRounds = 0
                reason = 'idle'

                try {
                    while (!runtime.abort.signal.aborted) {
                        if (Context.needsCompact(sessionID)) await Compact.run(sessionID, runtime.abort.signal, onEvent)
                        const availableTools = await Tool.list(sessionID)
                        const tools = Object.fromEntries(Object.values(availableTools).map(tool => [tool.name, dynamicTool({
                            description: tool.description,
                            inputSchema: jsonSchema(tool.inputSchema),
                            toModelOutput: tool.toModelOutput ? ({ output }) => tool.toModelOutput!(output) as any : undefined,
                        })]))
                        const request = await Plugin.emit('request.before', {
                            sessionID,
                            messages: await Context.build(sessionID, tools),
                            tools,
                            instructions: [
                                Store.config.prompts.system,
                                Store.config.prompts.tool,
                                'Continue using tools until the request is complete. You must call finish when complete or ask_user when blocked; never end by returning text alone.',
                            ].filter(Boolean).join('\n\n'),
                        })
                        const result = await LLM.chat({
                            provider: session.provider,
                            modelID: session.model,
                            messages: request.messages,
                            tools: request.tools,
                            instructions: request.instructions,
                            signal: runtime.abort.signal,
                            onPart: async part => {
                                await onEvent?.(part)
                                await Plugin.emit('part.stream', { sessionID, part })
                            },
                        })
                        const answer: AgentMessage = { ...result.message, createdAt: new Date().toISOString(), usage: result.usage }
                        const toolParts = answer.parts.filter(isToolUIPart)
                        idleRounds = toolParts.length ? 0 : idleRounds + 1
                        let toolStopped = false
                        await Session.append(sessionID, answer)

                        for (const [partIndex, part] of answer.parts.entries()) {
                            if (!isToolUIPart(part) || part.state !== 'input-available') continue
                            const toolName = getToolName(part)
                            try {
                                const allowed = await Permission.request(sessionID, part.toolCallId, toolName, part.input, onEvent)
                                if (!allowed) {
                                    Object.assign(part, { state: 'output-error', errorText: 'User denied this tool call.' })
                                } else {
                                    const before = await Plugin.emit('tool.before', { sessionID, toolName, input: part.input })
                                    const tool = availableTools[toolName]
                                    if (!tool) throw new globalThis.Error(`Tool not found: ${toolName}`)
                                    const output = await tool.execute(before.input, {
                                        sessionID, messageID: answer.id, partIndex, signal: runtime.abort.signal,
                                    })
                                    Object.assign(part, { state: 'output-available', output: output.output })
                                    await Plugin.emit('tool.after', { sessionID, toolName, input: before.input, output: output.output })
                                    toolStopped ||= Boolean(output.stop)
                                }
                            } catch (error) {
                                Object.assign(part, {
                                    state: 'output-error',
                                    errorText: runtime.abort.signal.aborted ? 'User cancelled.' : String(error),
                                })
                            }
                            await Session.rewrite(sessionID)
                        }

                        await onEvent?.({ type: 'data-message-end', data: { message: answer }, transient: true })
                        await Plugin.emit('message.append', { sessionID, message: answer })
                        if (toolStopped) {
                            reason = 'tool'
                            break
                        }
                        if (Store.config.context.idleRounds > 0 && idleRounds >= Store.config.context.idleRounds) {
                            throw new globalThis.Error(`Model did not call finish or ask_user after ${idleRounds} idle rounds`)
                        }
                    }
                    if (runtime.abort.signal.aborted) reason = 'abort'
                } catch (error) {
                    reason = runtime.abort.signal.aborted ? 'abort' : 'error'
                    if (reason === 'error') throw error
                } finally {
                    await Plugin.emit('loop.end', { sessionID, reason })
                }
            } catch (error) {
                await onEvent?.({ type: 'error', errorText: String(error) })
            } finally {
                runtime.status = 'idle'
                await onEvent?.({ type: 'data-session-status', data: { status: 'idle', reason }, transient: true })
            }
        })()
        runtime.task = task
        return message
    } finally {
        release()
    }
}

export default { send, stop }
