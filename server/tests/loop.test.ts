import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { nanoid } from 'nanoid'
import Agent from '../commands/agent.ts'
import Config from '../commands/config.ts'
import Session from '../commands/session.ts'
import Workspace from '../commands/workspace.ts'
import Plugin from '../features/plugin.ts'
import Context from '../features/context.ts'
import Checkpoint from '../features/checkpoint.ts'
import Path from '../utils/path.ts'
import Store from '../store.ts'

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-loop-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults)
    Store.workspaces = {}
    Store.sessions = {}
    Store.runtimes = {}
    await Config.load()
    await Workspace.load()
    await Session.load()
})

describe('Agent loop', () => {
    it('runs independent tool calls in the same model turn concurrently', async () => {
        const directory = join(process.env.AGENT_HOME!, '.agent', 'tools')
        const times = ['a-start', 'a-end', 'b-start', 'b-end'].map(name => join(process.env.AGENT_HOME!, name))
        await mkdir(directory, { recursive: true })
        await Bun.write(join(directory, 'parallel.ts'), `export default {
            name: 'parallel_test', description: 'test concurrency', inputSchema: { type: 'object' },
            async execute(input) {
                await Bun.write(input.start, String(Date.now()))
                await Bun.sleep(50)
                await Bun.write(input.end, String(Date.now()))
                return { output: input }
            }
        }`)
        let step = 0
        const model = Bun.serve({ port: 0, fetch: () => {
            step += 1
            const calls = step === 1
                ? [
                    { index: 0, id: 'parallel-a', type: 'function', function: { name: 'parallel_test', arguments: JSON.stringify({ start: times[0], end: times[1] }) } },
                    { index: 1, id: 'parallel-b', type: 'function', function: { name: 'parallel_test', arguments: JSON.stringify({ start: times[2], end: times[3] }) } },
                ]
                : [{ index: 0, id: 'finish-parallel', type: 'function', function: { name: 'finish', arguments: '{"result":"done"}' } }]
            return new Response([
                `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: calls }, finish_reason: null }] })}\n\n`,
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
                'data: [DONE]\n\n',
            ].join(''), { headers: { 'content-type': 'text/event-stream' } })
        } })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Agent.send(session.id, 'run both')
        await Store.runtimes[session.id]!.task
        model.stop()
        const values = await Promise.all(times.map(path => Bun.file(path).text().then(Number)))
        const [aStart, aEnd, bStart, bEnd] = values as [number, number, number, number]
        expect(Math.max(aStart, bStart)).toBeLessThan(Math.min(aEnd, bEnd))
        expect(step).toBe(2)
        const firstAnswer = Store.sessions[session.id]!.messages[1]!
        expect(firstAnswer.parts.filter((part: any) => part.state === 'output-available')).toHaveLength(2)
    })

    it('executes a model tool call, checkpoints the file and stops through finish', async () => {
        const target = join(process.env.AGENT_HOME!, 'result.txt')
        let step = 0
        const model = Bun.serve({
            port: 0,
            async fetch() {
                step += 1
                const tool = step === 1
                    ? { id: 'write-call', name: 'file_write', arguments: JSON.stringify({ path: target, content: 'written' }) }
                    : { id: 'finish-call', name: 'finish', arguments: JSON.stringify({ result: 'done' }) }
                return new Response([
                    `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments } }] }, finish_reason: null }] })}\n\n`,
                    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
                    'data: [DONE]\n\n',
                ].join(''), { headers: { 'content-type': 'text/event-stream' } })
            },
        })
        Store.config.providers = [{
            name: 'mock',
            baseURL: `http://127.0.0.1:${model.port}/v1`,
            key: 'test',
            models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }],
        }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Agent.send(session.id, 'write the file')
        await Store.runtimes[session.id]!.task
        model.stop()

        expect(await readFile(target, 'utf8')).toBe('written')
        expect(step).toBe(2)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
        expect(Store.sessions[session.id]!.messages).toHaveLength(3)
        expect((await Checkpoint.list(session.id)).length).toBe(1)
        expect(Store.sessions[session.id]!.messages.at(-1)!.parts.some((part: any) => part.state === 'output-available')).toBe(true)
    })

    it('serializes concurrent sends and keeps only the newest running task', async () => {
        let calls = 0
        let active = 0
        let maxActive = 0
        const model = Bun.serve({
            port: 0,
            async fetch(request) {
                calls += 1
                active += 1
                maxActive = Math.max(maxActive, active)
                await Bun.sleep(30)
                active -= 1
                if (request.signal.aborted) return new Response('', { status: 499 })
                return new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
                    headers: { 'content-type': 'text/event-stream' },
                })
            },
        })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        Store.config.context.idleRounds = 1
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        const first = Agent.send(session.id, 'first')
        const second = Agent.send(session.id, 'second')
        const third = Agent.send(session.id, 'third')
        await Promise.all([first, second, third])
        await Store.runtimes[session.id]!.task
        model.stop()
        expect(Store.sessions[session.id]!.messages.filter(message => message.role === 'user').map(message => (message.parts[0] as any).text)).toEqual(['first', 'second', 'third'])
        expect(maxActive).toBe(1)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
    })

    it('does not let a loop-end hook block the session lifecycle', async () => {
        let calls = 0
        let releaseHook = () => {}
        const hookGate = new Promise<void>(resolve => { releaseHook = resolve })
        const model = Bun.serve({ port: 0, fetch: () => {
            calls += 1
            return new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
                headers: { 'content-type': 'text/event-stream' },
            })
        } })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.context.idleRounds = 1
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Plugin.reset()
        Plugin.setAPI({ Store })
        const directory = Path.plugins() + '/slow-loop-end'
        await mkdir(directory, { recursive: true })
        await Bun.write(directory + '/index.ts', `export default api => ({ name: 'slow-loop-end', hooks: { 'loop.end': () => api.wait() } })`)
        Plugin.setAPI({ Store, wait: () => hookGate })
        await Plugin.load('slow-loop-end')
        await Agent.send(session.id, 'first')
        while (calls < 1) await Bun.sleep(1)
        await Bun.sleep(10)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
        await Agent.send(session.id, 'second')
        await Store.runtimes[session.id]!.task
        expect(calls).toBe(2)
        releaseHook()
        model.stop()
        await Plugin.reset()
        expect(calls).toBe(2)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
    })

    it('stops while a request hook never resolves', async () => {
        const model = Bun.serve({ port: 0, fetch: () => new Response('unexpected') })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Plugin.reset()
        Plugin.setAPI({ Store })
        const directory = Path.plugins() + '/blocked-request'
        await mkdir(directory, { recursive: true })
        await Bun.write(directory + '/index.ts', `export default () => ({ name: 'blocked-request', hooks: { 'request.before': () => new Promise(() => {}) } })`)
        await Plugin.load('blocked-request')
        await Agent.send(session.id, 'block')
        await Bun.sleep(20)
        const stopped = await Promise.race([Agent.stop(session.id), Bun.sleep(500).then(() => 'timeout')])
        model.stop()
        await Plugin.reset()
        expect(stopped).toBe(true)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
    })

    it('stops while custom tool discovery never resolves', async () => {
        const model = Bun.serve({ port: 0, fetch: () => new Response('unexpected') })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        const project = join(process.env.AGENT_HOME!, 'blocked-discovery')
        await mkdir(join(project, '.agent', 'tools'), { recursive: true })
        await Bun.write(join(project, '.agent', 'tools', 'blocked.ts'), `await new Promise(() => {}); export default { name: 'blocked', description: 'blocked', inputSchema: { type: 'object' }, execute: () => ({ output: true }) }`)
        const workspace = await Workspace.add(project)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Agent.send(session.id, 'block discovery')
        await Bun.sleep(20)
        const stopped = await Promise.race([Agent.stop(session.id), Bun.sleep(500).then(() => 'timeout')])
        model.stop()
        expect(stopped).toBe(true)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
    })

    it('stops while a streamed-part hook never resolves', async () => {
        const model = Bun.serve({ port: 0, fetch: () => new Response(`data: {"choices":[{"delta":{"role":"assistant","content":"wait"},"finish_reason":null}]}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }) })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Plugin.reset()
        Plugin.setAPI({ Store })
        const directory = Path.plugins() + '/blocked-stream'
        await mkdir(directory, { recursive: true })
        await Bun.write(directory + '/index.ts', `export default () => ({ name: 'blocked-stream', hooks: { 'part.stream': () => new Promise(() => {}) } })`)
        await Plugin.load('blocked-stream')
        await Agent.send(session.id, 'block stream')
        await Bun.sleep(30)
        const stopped = await Promise.race([Agent.stop(session.id), Bun.sleep(500).then(() => 'timeout')])
        model.stop()
        await Plugin.reset()
        expect(stopped).toBe(true)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
    })

    it('stops one tool, persists its collected result and continues the agent', async () => {
        let step = 0
        const model = Bun.serve({
            port: 0,
            fetch: () => {
                step += 1
                const call = step === 1
                    ? { index: 0, id: 'shell-call', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: 'printf started; sleep 10' }) } }
                    : { index: 0, id: 'finish-after-stop', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ result: 'done' }) } }
                return new Response([
                `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [call] }, finish_reason: null }] })}\n\n`,
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
                'data: [DONE]\n\n',
                ].join(''), { headers: { 'content-type': 'text/event-stream' } })
            },
        })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        const events: any[] = []
        await Agent.send(session.id, 'wait', event => { events.push(event) })
        const started = Date.now()
        while (!events.some(event => event.type === 'data-tool-output' && event.data?.data === 'started') && Date.now() - started < 1000) await Bun.sleep(1)
        expect(Store.runtimes[session.id]!.operations.has('shell-call')).toBe(true)
        expect(await Agent.stop(session.id, 'shell-call')).toBe(true)
        await Store.runtimes[session.id]!.task
        model.stop()
        const tool = Store.sessions[session.id]!.messages[1]!.parts.find((part: any) => part.toolCallId === 'shell-call') as any
        expect(tool.state).toBe('output-available')
        expect(tool.output).toContain('started')
        expect(tool.output).toContain('User stopped tool execution.')
        expect(step).toBe(2)
    }, 10_000)

    it('cancels while a permission hook is still running', async () => {
        const model = Bun.serve({ port: 0, fetch: () => new Response([
            `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'permission-call', type: 'function', function: { name: 'file_list', arguments: JSON.stringify({ path: process.env.AGENT_HOME }) } }] }, finish_reason: null }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
            'data: [DONE]\n\n',
        ].join(''), { headers: { 'content-type': 'text/event-stream' } }) })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'ask' }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Plugin.reset()
        Plugin.setAPI({ Store })
        const directory = Path.plugins() + '/slow-permission'
        await mkdir(directory, { recursive: true })
        await Bun.write(directory + '/index.ts', `export default () => ({ name: 'slow-permission', hooks: { 'permission.request': async data => { await Bun.sleep(100); return data } } })`)
        await Plugin.load('slow-permission')
        await Agent.send(session.id, 'list')
        while (!Store.runtimes[session.id]!.operations.has('permission-call')) await Bun.sleep(1)
        const stopped = await Promise.race([Agent.stop(session.id), Bun.sleep(1000).then(() => 'timeout')])
        model.stop()
        await Plugin.reset()
        expect(stopped).toBe(true)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
        const permissionPart = Store.sessions[session.id]!.messages.at(-1)!.parts.find((part: any) => part.toolCallId === 'permission-call') as any
        expect(permissionPart.state).toBe('output-available')
        expect(permissionPart.output).toContain('User stopped tool execution.')
    })

    it('persists a denied tool result across reload', async () => {
        let step = 0
        const model = Bun.serve({ port: 0, fetch: () => {
            step += 1
            if (step === 1) return new Response([
                `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'denied-call', type: 'function', function: { name: 'file_list', arguments: JSON.stringify({ path: process.env.AGENT_HOME }) } }] }, finish_reason: null }] })}\n\n`,
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
                'data: [DONE]\n\n',
            ].join(''), { headers: { 'content-type': 'text/event-stream' } })
            return new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'stopped' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        } })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'ask' }]
        Store.config.context.idleRounds = 1
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Agent.send(session.id, 'list')
        while (!Store.runtimes[session.id]!.permission.has('denied-call')) await Bun.sleep(1)
        const permission = (await import('../features/permission.ts')).default
        permission.decide(Store.runtimes[session.id]!.permission.get('denied-call'), 'denied-call', { action: 'deny', scope: 'once' })
        await Store.runtimes[session.id]!.task
        model.stop()
        Store.sessions = {}
        Store.runtimes = {}
        await Session.load()
        const part = Store.sessions[session.id]!.messages[1]!.parts.find((item: any) => item.toolCallId === 'denied-call') as any
        expect(part.state).toBe('output-error')
        expect(part.errorText).toBe('User denied this tool call.')
    })

    it('sends an image read by a tool back to the model as file content', async () => {
        const imagePath = join(process.env.AGENT_HOME!, 'vision.png')
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGAAAABAAgMAAACYWpqdAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAACVBMVEX/AAAAAP////8Ul8VoAAAAAWJLR0QCZgt8ZAAAAAd0SU1FB+oIDQwUJKKmy7gAAAAdSURBVDjLY2BAAqFIgGFUYlRiVGJUYlRiVAK3BAAamf8BpyBzUwAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOC0xM1QxMjoyMDozNiswMDowMJHCgWMAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDgtMTNUMTI6MjA6MzYrMDA6MDDgnznfAAAAAElFTkSuQmCC', 'base64')
        await Bun.write(imagePath, png)
        let step = 0
        let receivedImage = false
        const model = Bun.serve({ port: 0, fetch: async request => {
            step += 1
            const body = await request.json() as any
            if (step === 2) {
                const serialized = JSON.stringify(body.messages)
                receivedImage = serialized.includes('image/png') && serialized.includes(png.toString('base64'))
            }
            const tool = step === 1
                ? { id: 'read-image', name: 'file_read', arguments: JSON.stringify({ path: imagePath }) }
                : { id: 'finish-image', name: 'finish', arguments: JSON.stringify({ result: 'red blue' }) }
            return new Response([
                `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments } }] }, finish_reason: null }] })}\n\n`,
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
                'data: [DONE]\n\n',
            ].join(''), { headers: { 'content-type': 'text/event-stream' } })
        } })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Agent.send(session.id, 'read the image')
        await Store.runtimes[session.id]!.task
        model.stop()
        expect(receivedImage).toBe(true)
        expect(step).toBe(2)
    })

    it('automatically compacts an oversized context before the next model round', async () => {
        let step = 0
        let compactedRequest = false
        const model = Bun.serve({ port: 0, fetch: async request => {
            step += 1
            const body = await request.json() as any
            if (step === 1) return new Response([
                `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'AUTOMATIC_SUMMARY' }, finish_reason: null }] })}\n\n`,
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
                'data: [DONE]\n\n',
            ].join(''), { headers: { 'content-type': 'text/event-stream' } })
            const serialized = JSON.stringify(body.messages)
            compactedRequest = serialized.includes('AUTOMATIC_SUMMARY') && !serialized.includes('OMITTED_MIDDLE_10')
            const tool = { id: 'finish-after-compact', name: 'finish', arguments: JSON.stringify({ result: 'done' }) }
            return new Response([
                `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments } }] }, finish_reason: null }] })}\n\n`,
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
                'data: [DONE]\n\n',
            ].join(''), { headers: { 'content-type': 'text/event-stream' } })
        } })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 600, maxOutput: 1000 }] }]
        Store.config.context.compactRatio = 0.5
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        for (let index = 0; index < 20; index += 1) await Session.append(session.id, {
            id: `history-${index}`,
            role: 'user',
            parts: [{ type: 'text', text: `${index === 10 ? 'OMITTED_MIDDLE_10 ' : ''}${'token '.repeat(30)}` }],
        })
        expect(Context.needsCompact(session.messages, Store.config.providers[0]!.models[0]!, Store.config.context.compactRatio)).toBe(true)
        await Agent.send(session.id, 'continue')
        await Store.runtimes[session.id]!.task
        model.stop()
        expect(step).toBe(2)
        expect(compactedRequest).toBe(true)
        expect(Store.sessions[session.id]!.messages.some(message => message.summary)).toBe(true)
    })

    it('reports an error instead of treating missing finish as completion', async () => {
        const model = Bun.serve({ port: 0, fetch: () => new Response(
            `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'text only' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
            { headers: { 'content-type': 'text/event-stream' } },
        ) })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.context.idleRounds = 2
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        const events: any[] = []
        await Agent.send(session.id, 'finish explicitly', event => { events.push(event) })
        await Store.runtimes[session.id]!.task
        model.stop()
        expect(events.some(event => event.type === 'error' && event.errorText.includes('did not call finish'))).toBe(true)
        expect(events.some(event => event.type === 'data-session-status' && event.data.reason === 'error')).toBe(true)
    })

    it('completes one hundred tool rounds without recursion or early stopping', async () => {
        let step = 0
        let protocolValid = true
        const model = Bun.serve({
            port: 0,
            fetch: async request => {
                step += 1
                const body = await request.json() as any
                if (step > 1) protocolValid &&= JSON.stringify(body.messages).includes(step <= 101 ? `list-${step - 1}` : 'finish-long-loop')
                const tool = step <= 100
                    ? { id: `list-${step}`, name: 'file_list', arguments: JSON.stringify({ path: process.env.AGENT_HOME }) }
                    : { id: 'finish-long-loop', name: 'finish', arguments: JSON.stringify({ result: 'done' }) }
                return new Response([
                    `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments } }] }, finish_reason: null }] })}\n\n`,
                    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
                    'data: [DONE]\n\n',
                ].join(''), { headers: { 'content-type': 'text/event-stream' } })
            },
        })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 10_000_000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Agent.send(session.id, 'run a long sequence')
        await Store.runtimes[session.id]!.task
        model.stop()

        expect(step).toBe(101)
        expect(protocolValid).toBe(true)
        expect(Store.sessions[session.id]!.messages).toHaveLength(102)
        expect(Store.sessions[session.id]!.messages.slice(1).every(message => message.parts.some((part: any) => part.state === 'output-available'))).toBe(true)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
        Store.sessions = {}
        Store.runtimes = {}
        await Session.load()
        expect(Store.sessions[session.id]!.messages).toHaveLength(102)
    }, 60_000)
})
