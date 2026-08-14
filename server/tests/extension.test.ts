import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { nanoid } from 'nanoid'
import Session from '../commands/session.ts'
import Config from '../commands/config.ts'
import Workspace from '../commands/workspace.ts'
import Plugin from '../features/plugin.ts'
import Path from '../utils/path.ts'
import Tool from '../utils/tool.ts'
import Retry from '../utils/retry.ts'
import Store from '../store.ts'

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-extension-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults)
    Store.workspaces = {}
    Store.sessions = {}
    Store.runtimes = {}
    await Config.load()
    await Workspace.load()
    await Session.load()
    await Plugin.reset()
    Plugin.setAPI({ Store, Session })
})

describe('Custom tools', () => {
    it('loads global and workspace tools without registration', async () => {
        const project = join(process.env.AGENT_HOME!, 'project')
        await mkdir(join(project, '.agent', 'tools'), { recursive: true })
        await mkdir(Path.tools(), { recursive: true })
        await writeFile(join(Path.tools(), 'global.ts'), `export default { name: 'global_tool', description: 'global', inputSchema: { type: 'object' }, execute: () => ({ output: 'global' }) }`)
        await writeFile(join(project, '.agent', 'tools', 'project.ts'), `export default { name: 'project_tool', description: 'project', inputSchema: { type: 'object' }, execute: () => ({ output: 'project' }) }`)
        const workspace = await Workspace.add(project)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const tools = await Tool.list(project, Plugin.tools())
        expect(tools.global_tool).toBeDefined()
        expect(tools.project_tool).toBeDefined()
        expect(tools.file_read).toBeDefined()
        await writeFile(join(project, '.agent', 'tools', 'project.ts'), `export default { name: 'project_tool', description: 'updated', inputSchema: { type: 'object' }, execute: () => ({ output: 'updated' }) }`)
        expect((await Tool.list(project)).project_tool!.description).toBe('updated')
    })
})

describe('Plugins', () => {
    it('loads, emits, registers tools and unloads a plugin', async () => {
        const directory = join(Path.plugins(), 'sample')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'index.ts'), `
            export default () => ({
                name: 'sample',
                hooks: { 'request.before': data => ({ ...data, changed: true }) },
                tools: [{ name: 'sample_tool', description: 'sample', inputSchema: { type: 'object' }, execute: () => ({ output: true }) }]
            })
        `)
        await Plugin.load('sample')
        expect(Plugin.list()).toContain('sample')
        expect(Plugin.tools().sample_tool).toBeDefined()
        expect((await Plugin.emit('request.before', {})).changed).toBe(true)
        await Plugin.unload('sample')
        expect(Plugin.tools().sample_tool).toBeUndefined()
    })

    it('physically stops a plugin tool before delayed side effects', async () => {
        const target = join(process.env.AGENT_HOME!, 'plugin-late.txt')
        const directory = join(Path.plugins(), 'controlled-plugin')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'index.ts'), `export default () => ({ name: 'controlled-plugin', tools: [{
            name: 'plugin_delay', description: 'delay', inputSchema: { type: 'object' },
            async execute(input, context) {
                await context.receive({ stream: 'output', data: 'started' })
                await Bun.sleep(50)
                await Bun.write(input.path, 'late')
                return { output: 'done' }
            }
        }] })`)
        await Plugin.load('controlled-plugin')
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const tool = Plugin.tools().plugin_delay!
        const message: any = { id: 'plugin-message', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: tool.name, toolCallId: 'plugin-call', state: 'input-available', input: { path: target } }] }
        let started = () => {}
        const output = new Promise<void>(resolve => { started = resolve })
        const running = Tool.run(session.id, message, { [tool.name]: tool }, Store.runtimes[session.id]!, { receive: () => { started() }, config: Store.config })
        await output
        Store.runtimes[session.id]!.operations.get('plugin-call')!.abort()
        await running
        await Bun.sleep(100)
        expect(await Bun.file(target).exists()).toBe(false)
    })

    it('executes an MCP tool through its persistent plugin client', async () => {
        Store.config.plugins.mcp = { enabled: true, settings: { servers: {
            test: { type: 'stdio', command: [process.execPath, resolve('node_modules/@modelcontextprotocol/server-everything/dist/index.js'), 'stdio'] },
        } } }
        await Plugin.load('mcp')
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const tool = Plugin.tools().test__echo!
        const message: any = { id: 'mcp-message', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: tool.name, toolCallId: 'mcp-call', state: 'input-available', input: { message: 'isolated' } }] }
        await Tool.run(session.id, message, { [tool.name]: tool }, Store.runtimes[session.id]!, { config: Store.config })
        expect(JSON.stringify(message.parts[0].output)).toContain('isolated')
    })

    it('does not retry a permanent MCP tool error', async () => {
        const count = join(process.env.AGENT_HOME!, 'mcp-errors.txt')
        const server = join(process.env.AGENT_HOME!, 'mcp-error-server.ts')
        await writeFile(server, `
            import { appendFileSync } from 'node:fs'
            import { McpServer } from ${JSON.stringify(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js'))}
            import { StdioServerTransport } from ${JSON.stringify(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js'))}
            const server = new McpServer({ name: 'error-test', version: '1.0.0' })
            server.registerTool('fail', { description: 'fail' }, async () => { appendFileSync(${JSON.stringify(count)}, 'call\\n'); throw new Error('invalid request') })
            await server.connect(new StdioServerTransport())
        `)
        Store.config.plugins.mcp = { enabled: true, settings: { servers: { error: { type: 'stdio', command: [process.execPath, server] } } } }
        await Plugin.load('mcp')
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const tool = Plugin.tools().error__fail!
        const message: any = { id: 'mcp-error-message', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: tool.name, toolCallId: 'mcp-error-call', state: 'input-available', input: {} }] }
        await Tool.run(session.id, message, { [tool.name]: tool }, Store.runtimes[session.id]!, {
            retry: (operation, signal) => Retry.run(operation, Store.config.retry, signal), config: Store.config,
        })
        await Plugin.reset()
        expect((await readFile(count, 'utf8')).trim().split('\n')).toHaveLength(1)
        expect(JSON.stringify(message.parts[0].output)).toContain('isError')
    })

    it('provides the kernel API to isolated plugin tools through RPC', async () => {
        const directory = join(Path.plugins(), 'api-plugin')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'index.ts'), `export default api => ({ name: 'api-plugin', tools: [{
            name: 'session_lookup', description: 'lookup', inputSchema: { type: 'object' },
            execute: async input => ({ output: await api.Session.read(input.id) })
        }] })`)
        await Plugin.load('api-plugin')
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const tool = Plugin.tools().session_lookup!
        const message: any = { id: 'api-message', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: tool.name, toolCallId: 'api-call', state: 'input-available', input: { id: session.id } }] }
        await Tool.run(session.id, message, { [tool.name]: tool }, Store.runtimes[session.id]!, {
            config: Store.config, api: (path, args) => Plugin.call(path, args),
        })
        expect(message.parts[0].output.id).toBe(session.id)
    })

    it('serializes concurrent plugin loads without leaking instances', async () => {
        const target = join(process.env.AGENT_HOME!, 'plugin-unloads.txt')
        const directory = join(Path.plugins(), 'concurrent')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'index.ts'), `export default () => ({
            name: 'concurrent', hooks: { 'plugin.load': () => Bun.sleep(30) },
            unload: () => Bun.write(${JSON.stringify(target)}, (require('node:fs').existsSync(${JSON.stringify(target)}) ? require('node:fs').readFileSync(${JSON.stringify(target)}, 'utf8') : '') + 'unload\\n')
        })`)
        await Promise.all([Plugin.load('concurrent'), Plugin.load('concurrent')])
        await Plugin.reset()
        expect((await readFile(target, 'utf8')).trim().split('\n')).toHaveLength(2)
    })

    it('keeps the working plugin when its replacement fails to load', async () => {
        const directory = join(Path.plugins(), 'replaceable')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'index.ts'), `export default () => ({ name: 'replaceable', tools: [{ name: 'old_tool', description: 'old', inputSchema: { type: 'object' }, execute: () => ({ output: true }) }] })`)
        await Plugin.load('replaceable')
        await Bun.sleep(5)
        await writeFile(join(directory, 'index.ts'), `export default () => ({ name: 'replaceable', hooks: { 'plugin.load': () => { throw new Error('broken replacement') } } })`)
        await expect(Plugin.load('replaceable')).rejects.toThrow('broken replacement')
        expect(Plugin.tools().old_tool).toBeDefined()
    })

    it('retains loaded state and config when plugin cleanup fails', async () => {
        const directory = join(Path.plugins(), 'failed-unload')
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'index.ts'), `export default () => ({ name: 'failed-unload', unload: () => { throw new Error('cleanup failed') } })`)
        await Config.save({ plugins: { 'failed-unload': { enabled: true } } })
        await Plugin.load('failed-unload')
        await expect(Plugin.setEnabled('failed-unload', false)).rejects.toThrow('cleanup failed')
        expect(Plugin.list()).toContain('failed-unload')
        expect(Store.config.plugins['failed-unload']?.enabled).toBe(true)
    })
})
