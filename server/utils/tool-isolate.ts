import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AgentTool, ConfigData, ToolContext, ToolResult } from '../types.ts'

const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
const supervisor = () => process.env.AGENT_TOOL_SUPERVISOR ?? fileURLToPath(new URL(`./tool-supervisor.${extension}`, import.meta.url))
const descendants = (pid: number): number[] => {
    let children: number[] = []
    try { children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number) } catch { return [] }
    return children.flatMap(child => [child, ...descendants(child)])
}
const kill = (child: ReturnType<typeof Bun.spawn>, signal: NodeJS.Signals = 'SIGKILL') => {
    if (signal === 'SIGKILL') {
        try { process.kill(-child.pid, 'SIGSTOP') } catch {}
        const tree = descendants(child.pid)
        for (const pid of tree) try { process.kill(pid, 'SIGSTOP') } catch {}
        for (const pid of tree.reverse()) try { process.kill(pid, 'SIGKILL') } catch {}
    }
    try { process.kill(-child.pid, signal) } catch { child.kill(signal) }
}

const list = (source: string, signal?: AbortSignal) => new Promise<Pick<AgentTool, 'name' | 'description' | 'inputSchema'>[]>((resolve, reject) => {
    let child: ReturnType<typeof Bun.spawn>
    let settled = false
    const timeout = setTimeout(() => finish(new Error(`Tool discovery timed out: ${source}`)), 10_000)
    const finish = (result: any) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
        kill(child)
        result instanceof Error ? reject(result) : resolve(result)
    }
    const abort = () => finish(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    child = Bun.spawn([process.execPath, supervisor()], {
        detached: true, stdout: 'ignore', stderr: 'pipe',
        ipc: message => message.type === 'definitions' ? finish(message.definitions) : message.type === 'error' && finish(new Error(message.error)),
        onExit: async process => finish(new Error(await new Response(process.stderr).text() || 'Tool discovery failed')),
    })
    signal?.addEventListener('abort', abort, { once: true })
    try { child.send({ type: 'list', source }) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
})

const run = (tool: AgentTool, input: unknown, context: ToolContext, config?: ConfigData, api?: (path: string, args: unknown[]) => unknown | Promise<unknown>) => new Promise<ToolResult>((resolve, reject) => {
    let settled = false
    let requests = Promise.resolve()
    let child: ReturnType<typeof Bun.spawn>
    const finish = (result: ToolResult | Error) => {
        if (settled) return
        settled = true
        context.signal.removeEventListener('abort', abort)
        kill(child)
        result instanceof Error ? reject(result) : resolve(result)
    }
    const abort = () => finish(context.signal.reason instanceof Error ? context.signal.reason : new DOMException('Aborted', 'AbortError'))
    if (context.signal.aborted) return reject(context.signal.reason instanceof Error ? context.signal.reason : new DOMException('Aborted', 'AbortError'))
    child = Bun.spawn([process.execPath, supervisor()], {
        detached: true,
        stdout: 'ignore',
        stderr: 'pipe',
        ipc: async message => {
            if (message.type === 'result' || message.type === 'error') {
                await requests
                return finish(message.type === 'result' ? message.result : new Error(message.error))
            }
            requests = requests.then(async () => {
                try {
                    if (message.type === 'receive') await context.receive?.(message.event)
                    if (message.type === 'checkpoint') await context.checkpoint?.(message.path)
                    if (message.type === 'api') message.value = await api?.(message.path, message.args)
                    child.send({ type: 'response', id: message.id, value: message.value })
                } catch (error) { child.send({ type: 'response', id: message.id, error: String(error) }) }
            })
            await requests
        },
        onExit: async process => { if (!settled) finish(new Error(await new Response(process.stderr).text() || 'Tool process exited without a result')) },
    })
    context.signal.addEventListener('abort', abort, { once: true })
    try { child.send({ type: 'run', source: tool.source, factory: tool.factory, name: tool.name, input, config, context: {
        sessionID: context.sessionID, messageID: context.messageID, partIndex: context.partIndex,
    } }) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
})

export default { list, run }
