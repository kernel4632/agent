import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { nanoid } from 'nanoid'
import Session from '../commands/session.ts'
import Config from '../commands/config.ts'
import Workspace from '../commands/workspace.ts'
import Store from '../store.ts'
import Tool from '../utils/tool.ts'
import Checkpoint from '../features/checkpoint.ts'
import Retry from '../utils/retry.ts'
import type { AgentMessage, AgentTool, ToolOutputEvent } from '../types.ts'

let sessionID: string
let project: string

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-tools-${nanoid()}`)
    project = join(process.env.AGENT_HOME, 'project')
    await mkdir(project, { recursive: true })
    Store.config = structuredClone(Store.defaults)
    Store.workspaces = {}
    Store.sessions = {}
    Store.runtimes = {}
    await Config.load()
    await Workspace.load()
    await Session.load()
    const workspace = await Workspace.add(project)
    sessionID = (await Session.create(workspace.id, 'provider', 'model')).id
})

const execute = async (tool: AgentTool, input: unknown, receive?: (event: ToolOutputEvent) => void) => {
    const messageID = nanoid()
    const message: AgentMessage = { id: messageID, role: 'assistant', parts: [{
        type: 'dynamic-tool', toolName: tool.name, toolCallId: messageID, state: 'input-available', input,
    } as any] }
    await Tool.run(sessionID, message, { [tool.name]: tool }, Store.runtimes[sessionID]!, {
        receive: (_callID, _tool, event) => receive?.(event),
        checkpoint: async (id, partIndex, path) => { await Checkpoint.save(sessionID, { messageID: id, partIndex }, path) },
        retry: (operation, signal) => Retry.run(operation, { baseDelay: 1, factor: 2, maxDelay: 2 }, signal),
    })
    const result = message.parts[0] as any
    if (result.state === 'output-error') throw new Error(result.errorText)
    return result
}

describe('Built-in tools', () => {
    it('streams output and returns the collected output when externally stopped', async () => {
        const directory = join(project, '.agent', 'tools')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'controlled.ts'), `export default {
            name: 'controlled', description: 'test', inputSchema: { type: 'object' },
            async execute(_input, context) {
                await context.receive({ stream: 'stdout', data: 'partial' })
                await Bun.sleep(1000)
                return { output: 'late' }
            }
        }`)
        const tool = (await Tool.list(project)).controlled!
        let started = () => {}
        const outputStarted = new Promise<void>(resolve => { started = resolve })
        const events: ToolOutputEvent[] = []
        const message: AgentMessage = { id: 'controlled-message', role: 'assistant', parts: [{
            type: 'dynamic-tool', toolName: tool.name, toolCallId: 'controlled-call', state: 'input-available', input: {},
        } as any] }
        const running = Tool.run(sessionID, message, { controlled: tool }, Store.runtimes[sessionID]!, {
            receive: (_callID, _tool, event) => { events.push(event); started() },
        })
        const phase = await Promise.race([outputStarted.then(() => 'output'), running.then(() => 'done')])
        if (phase === 'done') throw new Error(JSON.stringify(message.parts[0]))
        Store.runtimes[sessionID]!.operations.get('controlled-call')!.abort(new DOMException('Stopped', 'AbortError'))
        await running

        expect(events).toEqual([{ stream: 'stdout', data: 'partial' }])
        expect(message.parts[0]).toMatchObject({
            state: 'output-available',
            output: 'partial\nUser stopped tool execution.',
        })
    })

    it('writes, reads, edits and lists files with checkpoints', async () => {
        const tools = await Tool.list(project)
        const path = join(project, 'hello.txt')
        await execute(tools.file_write!, { path, content: 'hello' })
        expect((await execute(tools.file_read!, { path })).output).toBe('hello')
        await execute(tools.edit!, { path, oldText: 'hello', newText: 'world' })
        expect(await readFile(path, 'utf8')).toBe('world')
        expect(((await execute(tools.file_list!, { path: project })).output as string[])).toContain('hello.txt')
    })

    it('returns image bytes as actual AI SDK file content', async () => {
        const tools = await Tool.list(project)
        const path = join(project, 'pixel.png')
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=', 'base64')
        await writeFile(path, png)
        const result = await execute(tools.file_read!, { path })
        const modelOutput = tools.file_read!.toModelOutput!(result.output) as any
        expect(modelOutput.type).toBe('content')
        expect(modelOutput.value[1].type).toBe('file')
        expect(modelOutput.value[1].mediaType).toBe('image/png')
        expect(modelOutput.value[1].data.data).toBe(png.toString('base64'))
    })

    it('runs shell, glob and grep against real files', async () => {
        const tools = await Tool.list(project)
        await writeFile(join(project, 'search.txt'), 'needle\n')
        const events: ToolOutputEvent[] = []
        const shell = await execute(tools.shell!, { command: 'printf shell-ok', path: project }, event => events.push(event))
        expect((shell.output as any).stdout).toBe('shell-ok')
        expect(events).toEqual([{ stream: 'stdout', data: 'shell-ok' }])
        expect(((await execute(tools.glob!, { path: project, pattern: '*.txt' })).output as string[])).toContain('search.txt')
        const grep = await execute(tools.grep!, { path: project, pattern: 'needle' })
        expect((grep.output as any[]).some(event => event.data?.lines?.text === 'needle\n')).toBe(true)
    })

    it('fetches an HTTP page', async () => {
        const server = Bun.serve({ port: 0, fetch: () => new Response('web-ok') })
        const tools = await Tool.list(project)
        const result = await execute(tools.web_fetch!, { url: `http://127.0.0.1:${server.port}` })
        server.stop()
        expect((result.output as any).body).toBe('web-ok')
    })

    it('does not retry a permanent HTTP error', async () => {
        let requests = 0
        const server = Bun.serve({ port: 0, fetch: () => { requests += 1; return new Response('bad', { status: 400 }) } })
        const tools = await Tool.list(project)
        await expect(execute(tools.web_fetch!, { url: `http://127.0.0.1:${server.port}` })).rejects.toThrow('HTTP 400')
        server.stop()
        expect(requests).toBe(1)
    })

    it('does not retry a conflict HTTP error', async () => {
        let requests = 0
        const server = Bun.serve({ port: 0, fetch: () => { requests += 1; return new Response('conflict', { status: 409 }) } })
        const tool = (await Tool.list(project)).web_fetch!
        await expect(tool.execute({ url: `http://127.0.0.1:${server.port}` }, { sessionID, messageID: 'web-conflict', partIndex: 0, signal: new AbortController().signal, retry: operation => Retry.run(operation, { baseDelay: 1, factor: 1, maxDelay: 1 }) })).rejects.toThrow()
        server.stop()
        expect(requests).toBe(1)
    })

    it('physically terminates a workspace tool before delayed side effects', async () => {
        const directory = join(project, '.agent', 'tools')
        const target = join(project, 'late.txt')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'delayed.ts'), `export default {
            name: 'delayed', description: 'delayed write', inputSchema: { type: 'object' },
            async execute(input, context) {
                await context.receive({ stream: 'output', data: 'started' })
                await Bun.sleep(50)
                await Bun.write(input.path, 'late')
                return { output: 'done' }
            }
        }`)
        const tool = (await Tool.list(project)).delayed!
        const message: AgentMessage = { id: 'delayed-message', role: 'assistant', parts: [{
            type: 'dynamic-tool', toolName: 'delayed', toolCallId: 'delayed-call', state: 'input-available', input: { path: target },
        } as any] }
        let started = () => {}
        const output = new Promise<void>(resolve => { started = resolve })
        const running = Tool.run(sessionID, message, { delayed: tool }, Store.runtimes[sessionID]!, {
            receive: () => { started() },
        })
        await output
        Store.runtimes[sessionID]!.operations.get('delayed-call')!.abort()
        await running
        await Bun.sleep(100)
        expect(await Bun.file(target).exists()).toBe(false)
    })

    it('kills subprocesses created by an isolated custom tool', async () => {
        const directory = join(project, '.agent', 'tools')
        const target = join(project, 'child-late.txt')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'child.ts'), `export default {
            name: 'child', description: 'child process', inputSchema: { type: 'object' },
            async execute(input, context) {
                const child = Bun.spawn(['sh', '-lc', 'sleep 0.05; printf late > "$1"', 'sh', input.path])
                await context.receive({ stream: 'output', data: 'started' })
                await child.exited
                return { output: 'done' }
            }
        }`)
        const tool = (await Tool.list(project)).child!
        const message: AgentMessage = { id: 'child-message', role: 'assistant', parts: [{
            type: 'dynamic-tool', toolName: 'child', toolCallId: 'child-call', state: 'input-available', input: { path: target },
        } as any] }
        let started = () => {}
        const output = new Promise<void>(resolve => { started = resolve })
        const running = Tool.run(sessionID, message, { child: tool }, Store.runtimes[sessionID]!, { receive: () => { started() } })
        await output
        Store.runtimes[sessionID]!.operations.get('child-call')!.abort()
        await running
        await Bun.sleep(100)
        expect(await Bun.file(target).exists()).toBe(false)
    })

    it('kills detached subprocesses created by an isolated custom tool', async () => {
        const target = join(project, 'detached-child.txt')
        const directory = join(project, '.agent', 'tools')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'detached.ts'), `export default { name: 'detached_child', description: 'detached', inputSchema: { type: 'object' }, async execute(input, context) {
            Bun.spawn([process.execPath, '-e', ${JSON.stringify(`await Bun.sleep(150); await Bun.write(process.argv[1], 'late')`)}, input.path], { detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).unref()
            await context.receive({ stream: 'output', data: 'started' })
            await new Promise(() => {})
        } }`)
        const tools = await Tool.list(project)
        const message: any = { id: 'detached-message', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'detached_child', toolCallId: 'detached-call', state: 'input-available', input: { path: target } }] }
        let started = () => {}
        const output = new Promise<void>(resolve => { started = resolve })
        const running = Tool.run(sessionID, message, tools, Store.runtimes[sessionID]!, { receive: () => { started() } })
        await output
        Store.runtimes[sessionID]!.operations.get('detached-call')!.abort()
        await running
        await Bun.sleep(250)
        expect(await Bun.file(target).exists()).toBe(false)
    })

    it('kills detached subprocesses after the tool executor exits itself', async () => {
        const target = join(project, 'detached-after-exit.txt')
        const directory = join(project, '.agent', 'tools')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'detached-exit.ts'), `export default { name: 'detached_exit', description: 'exit', inputSchema: { type: 'object' }, execute(input) {
            Bun.spawn([process.execPath, '-e', ${JSON.stringify(`await Bun.sleep(150); await Bun.write(process.argv[1], 'escaped')`)}, input.path], { detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).unref()
            process.exit(1)
        } }`)
        const tools = await Tool.list(project)
        const message: any = { id: 'detached-exit-message', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'detached_exit', toolCallId: 'detached-exit-call', state: 'input-available', input: { path: target } }] }
        await Tool.run(sessionID, message, tools, Store.runtimes[sessionID]!, {})
        await Bun.sleep(250)
        expect(await Bun.file(target).exists()).toBe(false)
    })

    it('prevents a tool from killing its isolation supervisor', async () => {
        const target = join(project, 'detached-after-parent-kill.txt')
        const directory = join(project, '.agent', 'tools')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'kill-parent.ts'), `export default { name: 'kill_parent', description: 'kill', inputSchema: { type: 'object' }, execute(input) {
            Bun.spawn([process.execPath, '-e', ${JSON.stringify(`await Bun.sleep(150); await Bun.write(process.argv[1], 'escaped')`)}, input.path], { detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }).unref()
            process.kill(process.ppid, 'SIGKILL')
        } }`)
        const tools = await Tool.list(project)
        const message: any = { id: 'kill-parent-message', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'kill_parent', toolCallId: 'kill-parent-call', state: 'input-available', input: { path: target } }] }
        await Tool.run(sessionID, message, tools, Store.runtimes[sessionID]!, {})
        await Bun.sleep(250)
        expect(await Bun.file(target).exists()).toBe(false)
    })

    it('waits for isolated output and checkpoint RPC before accepting the result', async () => {
        const directory = join(project, '.agent', 'tools')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'rpc.ts'), `export default {
            name: 'rpc', description: 'rpc', inputSchema: { type: 'object' },
            execute(input, context) {
                void context.receive({ stream: 'output', data: 'event' })
                void context.checkpoint(input.path)
                return { output: 'done' }
            }
        }`)
        const tool = (await Tool.list(project)).rpc!
        const message: AgentMessage = { id: 'rpc-message', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'rpc', toolCallId: 'rpc-call', state: 'input-available', input: { path: join(project, 'rpc.txt') } } as any] }
        const completed = { receive: false, checkpoint: false }
        await Tool.run(sessionID, message, { rpc: tool }, Store.runtimes[sessionID]!, {
            receive: async () => { await Bun.sleep(10); completed.receive = true },
            checkpoint: async () => { await Bun.sleep(10); completed.checkpoint = true },
        })
        expect(completed).toEqual({ receive: true, checkpoint: true })
        expect((message.parts[0] as any).output).toBe('done')
    })

    it('isolates custom tool module initialization from the kernel process', async () => {
        const directory = join(project, '.agent', 'tools')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'exit.ts'), `process.exit(0); export default { name: 'exit', description: 'exit', inputSchema: { type: 'object' }, execute: () => ({ output: true }) }`)
        await expect(Tool.list(project)).rejects.toThrow()
        expect(process.pid).toBeGreaterThan(0)
    })

    it('does not launch a custom tool for an already aborted session', async () => {
        const target = join(project, 'pre-aborted.txt')
        const directory = join(project, '.agent', 'tools')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'pre-aborted.ts'), `export default { name: 'pre_aborted', description: 'abort', inputSchema: { type: 'object' }, execute: async input => { await Bun.write(input.path, 'started'); return { output: true } } }`)
        const tools = await Tool.list(project)
        const runtime = Store.runtimes[sessionID]!
        runtime.abort.abort(new DOMException('Stopped', 'AbortError'))
        const message: any = { id: 'pre-aborted-message', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'pre_aborted', toolCallId: 'pre-aborted-call', state: 'input-available', input: { path: target } }] }
        await Tool.run(sessionID, message, tools, runtime, {})
        await Bun.sleep(50)
        expect(await Bun.file(target).exists()).toBe(false)
    })
})
