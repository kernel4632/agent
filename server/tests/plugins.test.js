import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Plugin from '../features/plugin.js'
import Path from '../utils/path.js'

beforeEach(async () => {
    for (const name of Plugin.list()) await Plugin.unload(name)
    process.env.AGENT_HOME = join(tmpdir(), `agent-plugin-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults); Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    await Store.load()
    Plugin.setAPI({ Store })
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
