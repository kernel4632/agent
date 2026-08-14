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

    it('keeps the session running until the loop-end hook has finished', async () => {
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
        expect(Store.runtimes[session.id]!.status).toBe('running')
        const second = Agent.send(session.id, 'second')
        await Bun.sleep(10)
        expect(calls).toBe(1)
        releaseHook()
        await second
        await Store.runtimes[session.id]!.task
        model.stop()
        await Plugin.reset()
        expect(calls).toBe(2)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
    })

    it('persists a cancelled tool as an AI SDK output error', async () => {
        const model = Bun.serve({
            port: 0,
            fetch: () => new Response([
                `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'shell-call', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: 'sleep 10' }) } }] }, finish_reason: null }] })}\n\n`,
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
                'data: [DONE]\n\n',
            ].join(''), { headers: { 'content-type': 'text/event-stream' } }),
        })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Agent.send(session.id, 'wait')
        const started = Date.now()
        while (!Store.runtimes[session.id]!.tools.size && Date.now() - started < 1000) await Bun.sleep(1)
        expect(Store.runtimes[session.id]!.tools.size).toBe(1)
        await Agent.stop(session.id)
        model.stop()
        const tool = Store.sessions[session.id]!.messages.at(-1)!.parts.find((part: any) => part.toolCallId === 'shell-call') as any
        expect(tool.state).toBe('output-error')
        expect(tool.errorText).toBe('User cancelled.')
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
        await Bun.sleep(20)
        const stopped = await Promise.race([Agent.stop(session.id), Bun.sleep(1000).then(() => 'timeout')])
        model.stop()
        await Plugin.reset()
        expect(stopped).toBe(true)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
        const permissionPart = Store.sessions[session.id]!.messages.at(-1)!.parts.find((part: any) => part.toolCallId === 'permission-call') as any
        expect(permissionPart.state).toBe('output-error')
        expect(permissionPart.errorText).toBe('User cancelled.')
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
        permission.decide(session.id, 'denied-call', { action: 'deny', scope: 'once' })
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
        expect(Context.needsCompact(session.id)).toBe(true)
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
