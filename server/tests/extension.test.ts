import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { nanoid } from 'nanoid'
import Session from '../commands/session.ts'
import Config from '../commands/config.ts'
import Workspace from '../commands/workspace.ts'
import Plugin from '../features/plugin.ts'
import Path from '../utils/path.ts'
import Tool from '../utils/tool.ts'
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
    Plugin.setAPI({ Store })
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
        const tools = await Tool.list(session.id)
        expect(tools.global_tool).toBeDefined()
        expect(tools.project_tool).toBeDefined()
        expect(tools.file_read).toBeDefined()
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
})
