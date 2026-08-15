import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Workspace from '../commands/workspace.js'
import Session from '../commands/session.js'
import Checkpoint from '../features/checkpoint.js'
import Tool from '../utils/tool.js'
import Path from '../utils/path.js'
import { readFile } from 'node:fs/promises'

let workspace, session
beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-tool-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    await Store.load()
    workspace = await Workspace.add(process.env.AGENT_HOME)
    session = await Session.create(workspace.id, 'openai', 'model')
})

const context = tools => ({
    sessionID: session.id, messageID: 'a1', partIndex: 0,
    tools,
    signal: new AbortController().signal, receive() {}, retry: operation => operation(),
    checkpoint: path => Checkpoint.save(session.id, { messageID: 'a1', partIndex: 0 }, path),
})

test('finds built-in and global custom tools without registration', async () => {
    await mkdir(Path.tools(), { recursive: true })
    await Bun.write(join(Path.tools(), 'hello.js'), `export default {
        name: 'hello', description: 'hello', inputSchema: { type: 'object' },
        execute: async () => ({ output: 'world' }),
    }`)
    const workspaceTools = join(workspace.path, '.agent', 'tools')
    await mkdir(workspaceTools, { recursive: true })
    await Bun.write(join(workspaceTools, 'local.js'), `export default {
        name: 'local', description: 'local', inputSchema: { type: 'object' },
        execute: async () => ({ output: 'workspace' }),
    }`)
    const tools = await Tool.list(workspace.path)
    const names = ['file_read', 'file_write', 'edit', 'shell', 'grep', 'glob', 'web_fetch', 'finish', 'hello', 'local']
    for (const name of names) expect(tools[name]).toBeDefined()
    expect(await Tool.execute('hello', {}, context(tools))).toEqual({ output: 'world' })
    await rm(join(Path.tools(), 'hello.js'))
    expect((await Tool.list(workspace.path)).hello).toBeUndefined()
})

test('keeps simultaneous workspace tool snapshots separate', async () => {
    const secondPath = join(process.env.AGENT_HOME, 'second')
    await mkdir(secondPath, { recursive: true })
    const second = await Workspace.add(secondPath)
    const secondSession = await Session.create(second.id, 'openai', 'model')
    const firstDirectory = join(workspace.path, '.agent', 'tools')
    const secondDirectory = join(second.path, '.agent', 'tools')
    await mkdir(firstDirectory, { recursive: true })
    await mkdir(secondDirectory, { recursive: true })
    await Bun.write(join(firstDirectory, 'local.js'), `export default {
        name: 'local', description: '', inputSchema: { type: 'object' },
        execute: async () => ({ output: 'first' }),
    }`)
    await Bun.write(join(secondDirectory, 'local.js'), `export default {
        name: 'local', description: '', inputSchema: { type: 'object' },
        execute: async () => ({ output: 'second' }),
    }`)

    const [firstTools, secondTools] = await Promise.all([Tool.list(workspace.path), Tool.list(second.path)])
    const [first, secondResult] = await Promise.all([
        Tool.execute('local', {}, context(firstTools)),
        Tool.execute('local', {}, { ...context(secondTools), sessionID: secondSession.id }),
    ])
    expect(first.output).toBe('first')
    expect(secondResult.output).toBe('second')
})

test('writes, edits, reads and searches real files', async () => {
    const tools = await Tool.list(workspace.path)
    const file = join(workspace.path, 'sample.txt')
    const ctx = context(tools)
    await Tool.execute('file_write', { path: file, content: 'alpha\nbeta\n' }, ctx)
    await Tool.execute('edit', { path: file, oldText: 'beta', newText: 'gamma' }, ctx)
    expect((await Tool.execute('file_read', { path: file }, ctx)).output).toContain('gamma')
    expect((await Tool.execute('glob', { path: workspace.path, pattern: '*.txt' }, ctx)).output).toContain('sample.txt')
    expect((await Tool.execute('grep', { path: workspace.path, pattern: 'gamma' }, ctx)).output).toHaveLength(1)
    expect((await Tool.execute('file_list', { path: workspace.path }, ctx)).output).toContain('sample.txt')
    const shell = await Tool.execute('shell', { command: 'pwd', cwd: workspace.path }, ctx)
    expect(shell.output.stdout.trim()).toBe(workspace.path)
    const web = Bun.serve({ port: 0, fetch: () => new Response('local page') })
    const page = await Tool.execute('web_fetch', { url: `http://127.0.0.1:${web.port}` }, ctx)
    expect(page.output.body).toBe('local page')
    web.stop()
    expect(await Tool.execute('ask_user', { question: 'Need input' }, ctx)).toEqual({
        output: { question: 'Need input' }, stop: true,
    })
})

test('serializes concurrent writes to one path and keeps both checkpoints', async () => {
    const tools = await Tool.list(workspace.path)
    const file = join(workspace.path, 'same.txt')
    const ctx = context(tools)
    await Promise.all([
        Tool.execute('file_write', { path: file, content: 'first' }, ctx),
        Tool.execute('file_write', { path: file, content: 'second' }, ctx),
    ])
    const logPath = `${Path.undo(session.id)}.jsonl`
    const log = (await readFile(logPath, 'utf8')).trim().split('\n').map(JSON.parse)
    expect(log.filter(item => item.type === 'write')).toHaveLength(2)
    expect(await Bun.file(file).text()).toBe('second')
})

test('aborting shell stops its child process group', async () => {
    const tools = await Tool.list(workspace.path)
    const controller = new AbortController()
    const started = Date.now()
    const pending = Tool.execute('shell', { command: 'sleep 30', cwd: workspace.path }, {
        ...context(tools), signal: controller.signal,
    })
    await Bun.sleep(20)
    controller.abort()
    const result = await pending
    expect(Date.now() - started).toBeLessThan(1000)
    expect(result.output).toHaveProperty('stdout')
})
