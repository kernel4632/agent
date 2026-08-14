import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import { dynamicTool, getToolName, isToolUIPart, jsonSchema } from 'ai'
import Path from './path.ts'
import Abort from './abort.ts'
import Isolate from './tool-isolate.ts'
import type { AgentMessage, AgentTool, ConfigData, RuntimeData, ToolContext, ToolOutputEvent } from '../types.ts'

type Callbacks = {
    receive?(callID: string, tool: string, event: ToolOutputEvent): void | Promise<void>
    permission?(callID: string, tool: string, input: unknown, signal: AbortSignal): boolean | Promise<boolean>
    checkpoint?(messageID: string, partIndex: number, path: string): void | Promise<void>
    retry?<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T>
    config?: ConfigData
    api?(path: string, args: unknown[]): unknown | Promise<unknown>
    before?(tool: string, input: unknown): unknown | Promise<unknown>
    after?(tool: string, input: unknown, output: unknown): void | Promise<void>
    save?(): void | Promise<void>
}

const list = async (workspacePath: string, supplied: Record<string, AgentTool> = {}, signal?: AbortSignal) => {
    const tools: Record<string, AgentTool> = {}
    const builtIn = resolve(dirname(fileURLToPath(import.meta.url)), '../tools')
    for (const directory of [builtIn, Path.tools(), Path.workspaceTools(workspacePath)]) {
        if (!await stat(directory).then(value => value.isDirectory()).catch(() => false)) continue
        const glob = new Bun.Glob('*.{js,ts}')
        for await (const file of glob.scan({ cwd: directory, absolute: true, onlyFiles: true })) {
            if (directory !== builtIn) {
                for (const tool of await Isolate.list(file, signal)) tools[tool.name] = { ...tool, source: file, execute: () => { throw new Error('Isolated tool') } }
                continue
            }
            const exported = (await import(`${file}?v=${(await stat(file)).mtimeMs}`)).default as AgentTool | AgentTool[]
            for (const tool of Array.isArray(exported) ? exported : [exported]) tools[tool.name] = { ...tool, source: file }
        }
    }
    return Object.assign(tools, supplied)
}

const models = (tools: Record<string, AgentTool>) => Object.fromEntries(Object.values(tools).map(tool => [tool.name, dynamicTool({
    description: tool.description,
    inputSchema: jsonSchema(tool.inputSchema),
    toModelOutput: tool.toModelOutput ? ({ output }) => tool.toModelOutput!(output) as any : undefined,
})]))

const run = async (sessionID: string, message: AgentMessage, tools: Record<string, AgentTool>, runtime: RuntimeData, callbacks: Callbacks) => {
    const execute = async (part: any, partIndex: number) => {
        const name = getToolName(part)
        const tool = tools[name]
        if (!tool) {
            Object.assign(part, { state: 'output-error', errorText: `Tool not found: ${name}` })
            await callbacks.save?.()
            return false
        }
        if (!tool.source) {
            Object.assign(part, { state: 'output-error', errorText: `Tool requires an isolated source: ${name}` })
            await callbacks.save?.()
            return false
        }
        const control = new AbortController()
        const signal = AbortSignal.any([runtime.abort.signal, control.signal])
        const output: string[] = []
        const completion = Promise.withResolvers<void>()
        runtime.operations.set(part.toolCallId, control)
        runtime.operationTasks.set(part.toolCallId, completion.promise)
        try {
            if (callbacks.permission && !await Abort.race(Promise.resolve(callbacks.permission(part.toolCallId, name, part.input, signal)), signal)) {
                return Object.assign(part, { state: 'output-error', errorText: 'User denied this tool call.' })
            }
            const input = callbacks.before ? await Abort.race(Promise.resolve(callbacks.before(name, part.input)), signal) : part.input
            const context: ToolContext = {
                sessionID, messageID: message.id, partIndex, signal,
                receive: async event => { output.push(event.data); await callbacks.receive?.(part.toolCallId, name, event) },
                checkpoint: async path => { await callbacks.checkpoint?.(message.id, partIndex, path) },
                retry: operation => callbacks.retry ? callbacks.retry(operation, signal) : operation(),
            }
            const result = tool.hosted
                ? await Abort.race(Promise.resolve(tool.execute(input, context)), signal)
                : await Isolate.run(tool, input, context, callbacks.config, callbacks.api)
            if (callbacks.after) await Abort.race(Promise.resolve(callbacks.after(name, input, result.output)), signal)
            Object.assign(part, { state: 'output-available', output: result.output })
            return result.stop
        } catch (error) {
            if (signal.aborted) Object.assign(part, { state: 'output-available', output: [...output, 'User stopped tool execution.'].join('\n') })
            else Object.assign(part, { state: 'output-error', errorText: String(error) })
        } finally {
            runtime.operations.delete(part.toolCallId)
            try { await callbacks.save?.() } finally {
                runtime.operationTasks.delete(part.toolCallId)
                completion.resolve()
            }
        }
    }
    const calls = message.parts.map((part, index) => isToolUIPart(part) && part.state === 'input-available' ? execute(part, index) : false)
    return (await Promise.all(calls)).some(Boolean)
}

export default { list, models, run }
