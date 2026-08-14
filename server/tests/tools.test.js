import { mkdir } from 'node:fs/promises'
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

let workspace, session
beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-tool-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults); Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    await Store.load()
    workspace = await Workspace.add(process.env.AGENT_HOME)
    session = await Session.create(workspace.id, 'openai', 'model')
})

const context = tools => ({
    tools, sessionID: session.id, messageID: 'a1', partIndex: 0,
    signal: new AbortController().signal, receive() {}, retry: operation => operation(),
    checkpoint: path => Checkpoint.save(session.id, { messageID: 'a1', partIndex: 0 }, path),
})

test('finds built-in and global custom tools without registration', async () => {
    await mkdir(Path.tools(), { recursive: true })
    await Bun.write(join(Path.tools(), 'hello.js'), `export default { name: 'hello', description: 'hello', inputSchema: { type: 'object' }, execute: async () => ({ output: 'world' }) }`)
    const tools = await Tool.list(workspace.path)
    for (const name of ['file_read', 'file_write', 'edit', 'shell', 'grep', 'glob', 'web_fetch', 'finish', 'hello']) expect(tools[name]).toBeDefined()
    expect(await Tool.execute('hello', {}, context(tools))).toEqual({ output: 'world' })
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
    expect((await Tool.execute('shell', { command: 'pwd', cwd: workspace.path }, ctx)).output.code).toBe(0)
})
