import { isToolUIPart } from 'ai'
import Plugin from '../features/plugin.ts'
import Compact from '../features/compact.ts'
import Context from '../features/context.ts'
import Permission from '../features/permission.ts'
import Checkpoint from '../features/checkpoint.ts'
import LLM from '../utils/llm.ts'
import Tool from '../utils/tool.ts'
import Retry from '../utils/retry.ts'
import Abort from '../utils/abort.ts'
import Store from '../store.ts'
import Session from './session.ts'
import Config from './config.ts'
import type { AgentMessage, ModelConfig, ProviderConfig, RuntimeData, SessionData, WorkspaceData } from '../types.ts'
import type { UIMessageChunk } from 'ai'

const run = async ({ sessionID, session, message, runtime, provider, model, workspace, onEvent }: {
    sessionID: string
    session: SessionData
    message: AgentMessage
    runtime: RuntimeData
    provider: ProviderConfig
    model: ModelConfig
    workspace: WorkspaceData
    onEvent?: (event: UIMessageChunk) => void | Promise<void>
}) => {
    let reason = 'idle'
    let idleRounds = 0
    const hook = (name: Parameters<typeof Plugin.emit>[0], data: any) => Abort.race(Plugin.emit(name, { ...data, signal: runtime.abort.signal }), runtime.abort.signal)
    try {
        await Session.append(sessionID, message)
        await Session.touch(sessionID)
        await hook('message.append', { sessionID, message })
        await onEvent?.({ type: 'data-session-status', data: { status: 'running' }, transient: true })
        await hook('loop.start', { sessionID })
        while (!runtime.abort.signal.aborted) {
            if (Context.needsCompact(session.messages, model, Store.config.context.compactRatio)) {
                const summary = await Compact.run(session.messages, {
                    signal: runtime.abort.signal,
                    receive: onEvent,
                    chat: (messages, options) => LLM.chat({ provider, model, retry: Store.config.retry, messages, instructions: Store.config.prompts.summary }, options),
                })
                await Session.append(sessionID, summary)
                await onEvent?.({ type: 'data-compact-done', data: { message: summary }, transient: true })
                await hook('message.append', { sessionID, message: summary })
            }
            const availableTools = await Tool.list(workspace.path, Plugin.tools(), runtime.abort.signal)
            const tools = Tool.models(availableTools)
            const request = await hook('request.before', { sessionID, ...await Context.request(session.messages, tools, [Store.config.prompts.system, Store.config.prompts.tool, 'Continue using tools until the request is complete. You must call finish when complete or ask_user when blocked; never end by returning text alone.']) })
            const result = await LLM.chat({ provider, model, retry: Store.config.retry, messages: request.messages, tools: request.tools, instructions: request.instructions }, {
                signal: runtime.abort.signal,
                receive: async part => { await onEvent?.(part); await hook('part.stream', { sessionID, part }) },
            })
            const answer: AgentMessage = { ...result.message, createdAt: new Date().toISOString(), usage: result.usage }
            idleRounds = answer.parts.some(isToolUIPart) ? 0 : idleRounds + 1
            await Session.append(sessionID, answer)
            runtime.events = []
            const toolStopped = await Tool.run(sessionID, answer, availableTools, runtime, {
                receive: (callID, tool, event) => onEvent?.({ type: 'data-tool-output', data: { callID, tool, ...event }, transient: true }),
                permission: (callID, tool, input, signal) => Permission.request({ callID, tool, input, rules: Store.config.permission }, {
                    signal, receive: onEvent, inspect: request => Plugin.emit('permission.request', { sessionID, ...request }),
                    wait: resolve => { runtime.permission.set(callID, resolve); return () => runtime.permission.delete(callID) },
                    persist: rule => Config.save(config => ({ permission: [...config.permission, rule] })),
                }),
                checkpoint: async (messageID, partIndex, path) => { await Checkpoint.save(sessionID, { messageID, partIndex }, path) },
                retry: (operation, signal) => Retry.run(operation, Store.config.retry, signal),
                config: Store.config,
                api: (path, args) => Plugin.call(path, args),
                before: async (tool, input) => (await Plugin.emit('tool.before', { sessionID, toolName: tool, input })).input,
                after: async (tool, input, output) => { await Plugin.emit('tool.after', { sessionID, toolName: tool, input, output }) },
                save: () => Session.rewrite(sessionID),
            })
            runtime.events = []
            await onEvent?.({ type: 'data-message-end', data: { message: answer }, transient: true })
            await hook('message.append', { sessionID, message: answer })
            if (toolStopped) { reason = 'tool'; break }
            if (Store.config.context.idleRounds > 0 && idleRounds >= Store.config.context.idleRounds) throw new globalThis.Error(`Model did not call finish or ask_user after ${idleRounds} idle rounds`)
        }
        if (runtime.abort.signal.aborted) reason = 'abort'
    } catch (error) {
        reason = runtime.abort.signal.aborted ? 'abort' : 'error'
        if (reason === 'error') await onEvent?.({ type: 'error', errorText: String(error) })
    } finally {
        void Plugin.emit('loop.end', { sessionID, reason, signal: runtime.abort.signal }).catch(() => undefined)
        runtime.status = 'idle'
        await onEvent?.({ type: 'data-session-status', data: { status: 'idle', reason }, transient: true })
        runtime.events = []
    }
}

export default run
