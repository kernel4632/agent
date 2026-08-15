import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Plugin from '../features/plugin.js'
import Path from '../utils/path.js'
import Session from '../commands/session.js'
import Workspace from '../commands/workspace.js'
import LLM from '../utils/llm.js'

beforeEach(async () => {
    for (const name of Plugin.list()) await Plugin.unload(name)
    process.env.AGENT_HOME = join(tmpdir(), `agent-plugin-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    await Store.load()
    Plugin.setAPI({ Store, LLM })
})

test('loads user plugins with hooks and tools from disk', async () => {
    const directory = join(Path.plugins(), 'demo')
    await mkdir(directory, { recursive: true })
    await Bun.write(join(directory, 'index.js'), `export default () => ({ name: 'demo', hooks: { test: data => ({ ...data, changed: true }) }, tools: [{ name: 'demo_tool', description: '', inputSchema: { type: 'object' }, execute: async () => ({ output: 1 }) }] })`)
    expect(await Plugin.load('demo')).toEqual(['demo'])
    expect(await Plugin.emit('test', { value: 1 })).toEqual({ value: 1, changed: true })
    expect(Plugin.tools().demo_tool.name).toBe('demo_tool')
    expect(await Plugin.unload('demo')).toBe(true)
})

test('removes a plugin when its directory disappears', async () => {
    const directory = join(Path.plugins(), 'vanish')
    await mkdir(directory, { recursive: true })
    await Bun.write(join(directory, 'index.js'), `export default () => ({ name: 'vanish' })`)
    await Plugin.load('vanish')
    await rm(directory, { recursive: true, force: true })
    await Plugin.load()
    expect(Plugin.list()).not.toContain('vanish')
})

test('does not explicitly load a disabled plugin', async () => {
    const directory = join(Path.plugins(), 'disabled')
    await mkdir(directory, { recursive: true })
    await Bun.write(join(directory, 'index.js'), `export default () => ({ name: 'disabled' })`)
    Store.config.plugins.disabled = { enabled: false }
    expect(await Plugin.load('disabled')).not.toContain('disabled')
})

test('title plugin uses the injected model and session API', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    Store.config.providers = [{ name: 'mock', baseURL: 'http://unused', key: 'test', models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }] }]
    const session = await Session.create(workspace.id, 'mock', 'model')
    Plugin.setAPI({ Store, Session, LLM: { stream: async () => ({ message: { parts: [{ type: 'text', text: 'Short title' }] } }) } })
    await Plugin.load('title')
    await Plugin.emit('message.append', { sessionID: session.id, message: { id: 'u', role: 'user', parts: [{ type: 'text', text: 'request' }] } })
    expect(Store.workspaces[workspace.id].sessions[0].title).toBe('Short title')
    await Plugin.unload('title')
})

test('websearch plugin calls an OpenAI-compatible search endpoint', async () => {
    Store.config.plugins.websearch = {
        enabled: true,
        settings: { baseURL: 'http://search', key: 'test', model: 'search' },
    }
    Plugin.setAPI({ Store, LLM: { stream: async request => {
        expect(request.messages.at(-1).content).toBe('latest news')
        return { message: { parts: [{ type: 'text', text: 'result' }] } }
    } } })
    await Plugin.load('websearch')
    const tool = Plugin.tools().web_search
    const result = await tool.execute({ query: 'latest news' }, { signal: AbortSignal.timeout(5000), retry: action => action() })
    expect(result.output.text).toBe('result')
    await Plugin.unload('websearch')
})

test('cron plugin loads and unloads configured jobs', async () => {
    Store.config.plugins.cron = { enabled: true, settings: { jobs: [{ cron: '* * * * * *', sessionID: 'missing', message: 'tick' }] } }
    Plugin.setAPI({ Store, Agent: { send: async () => {} } })
    expect(await Plugin.load('cron')).toContain('cron')
    expect(await Plugin.unload('cron')).toBe(true)
})

test('cron plugin triggers the public Agent API', async () => {
    let calls = 0
    Store.config.plugins.cron = { enabled: true, settings: { jobs: [{ cron: '* * * * * *', sessionID: 'scheduled', message: 'tick' }] } }
    Plugin.setAPI({ Store, Agent: { send: async () => { calls += 1 } } })
    await Plugin.load('cron')
    await Bun.sleep(1200)
    expect(calls).toBeGreaterThan(0)
    await Plugin.unload('cron')
})

test('MCP stdio plugin discovers tools and closes its client', async () => {
    Store.config.plugins.mcp = { enabled: true, settings: { servers: { everything: { type: 'stdio', command: ['node', join(process.cwd(), 'node_modules/@modelcontextprotocol/server-everything/dist/index.js'), 'stdio'] } } } }
    Plugin.setAPI({ Store })
    await Plugin.load('mcp')
    expect(Object.keys(Plugin.tools()).length).toBeGreaterThan(0)
    const tool = Object.values(Plugin.tools()).find(item => item.toModelOutput)
    expect(tool.toModelOutput({ content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }] })).toEqual({ type: 'content', value: [{ type: 'file', data: { type: 'data', data: 'abc' }, mediaType: 'image/png' }] })
    expect(tool.toModelOutput({ content: [] })).toEqual({ type: 'content', value: [{ type: 'text', text: '' }] })
    expect(await Plugin.unload('mcp')).toBe(true)
})

test('MCP plugin connects through streamable HTTP', async () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response('probe') })
    const port = probe.port
    probe.stop()
    const child = Bun.spawn(['node', join(process.cwd(), 'node_modules/@modelcontextprotocol/server-everything/dist/index.js'), 'streamableHttp'], { env: { ...process.env, PORT: String(port) }, stdout: 'ignore', stderr: 'ignore' })
    for (let attempt = 0; attempt < 30; attempt++) {
        try { await fetch(`http://127.0.0.1:${port}/mcp`); break } catch { await Bun.sleep(50) }
    }
    Store.config.plugins.mcp = { enabled: true, settings: { servers: { http: { type: 'http', url: `http://127.0.0.1:${port}/mcp` } } } }
    Plugin.setAPI({ Store })
    await Plugin.load('mcp')
    const echo = Plugin.tools().http__echo
    expect(echo).toBeDefined()
    expect((await echo.execute({ message: 'hello' }, { signal: AbortSignal.timeout(5000) })).output.content[0].text).toBe('Echo: hello')
    await Plugin.unload('mcp')
    child.kill()
    await child.exited
})
