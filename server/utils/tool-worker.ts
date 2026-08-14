import Retry from './retry.ts'
import Seccomp from './seccomp.ts'
import type { AgentTool, PluginModule, ToolOutputEvent } from '../types.ts'

Seccomp.install()

const pending = new Map<number, { resolve(value?: unknown): void; reject(error: Error): void }>()
let requestID = 0
const request = (type: string, data: object) => new Promise((resolve, reject) => {
    const id = requestID++
    pending.set(id, { resolve, reject })
    process.send?.({ type, id, ...data })
})

process.on('message', async (run: any) => {
    if (run.type === 'response') {
        const promise = pending.get(run.id)
        pending.delete(run.id)
        return run.error ? promise?.reject(new Error(run.error)) : promise?.resolve(run.value)
    }
    if (run.type !== 'run') return
    try {
        const exported = (await import(run.source)).default
        let tools: AgentTool[]
        const remote = (path: string): any => new Proxy(() => undefined, {
            get: (_target, name) => remote(`${path}.${String(name)}`),
            apply: (_target, _this, args) => request('api', { path, args }),
        })
        const api = { Store: { config: run.config }, Agent: remote('Agent'), Session: remote('Session'), LLM: remote('LLM') }
        if (run.factory) tools = (await exported(api) as PluginModule).tools ?? []
        else tools = Array.isArray(exported) ? exported : [exported as AgentTool]
        const tool = tools.find(tool => tool.name === run.name)
        if (!tool) throw new Error(`Tool not found: ${run.name}`)
        const result = await tool.execute(run.input, {
            ...run.context,
            signal: new AbortController().signal,
            receive: (event: ToolOutputEvent) => request('receive', { event }),
            checkpoint: (path: string) => request('checkpoint', { path }),
            retry: <T>(operation: () => Promise<T>) => run.config?.retry ? Retry.run(operation, run.config.retry) : operation(),
        })
        process.send?.({ type: 'result', result })
    } catch (error) { process.send?.({ type: 'error', error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
})

process.on('message', async (message: any) => {
    if (message.type !== 'list') return
    try {
        const exported = (await import(message.source)).default as AgentTool | AgentTool[]
        const tools = Array.isArray(exported) ? exported : [exported]
        process.send?.({ type: 'definitions', definitions: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    } catch (error) { process.send?.({ type: 'error', error: error instanceof Error ? error.stack ?? error.message : String(error) }) }
})
