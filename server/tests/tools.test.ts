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

const context = (messageID = nanoid()) => ({
    sessionID,
    messageID,
    partIndex: 0,
    signal: new AbortController().signal,
})

describe('Built-in tools', () => {
    it('writes, reads, edits and lists files with checkpoints', async () => {
        const tools = await Tool.list(sessionID)
        const path = join(project, 'hello.txt')
        await tools.file_write!.execute({ path, content: 'hello' }, context())
        expect((await tools.file_read!.execute({ path }, context())).output).toBe('hello')
        await tools.edit!.execute({ path, oldText: 'hello', newText: 'world' }, context())
        expect(await readFile(path, 'utf8')).toBe('world')
        expect(((await tools.file_list!.execute({ path: project }, context())).output as string[])).toContain('hello.txt')
    })

    it('returns image bytes as actual AI SDK file content', async () => {
        const tools = await Tool.list(sessionID)
        const path = join(project, 'pixel.png')
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=', 'base64')
        await writeFile(path, png)
        const result = await tools.file_read!.execute({ path }, context())
        const modelOutput = tools.file_read!.toModelOutput!(result.output) as any
        expect(modelOutput.type).toBe('content')
        expect(modelOutput.value[1].type).toBe('file')
        expect(modelOutput.value[1].mediaType).toBe('image/png')
        expect(modelOutput.value[1].data.data).toBe(png.toString('base64'))
    })

    it('runs shell, glob and grep against real files', async () => {
        const tools = await Tool.list(sessionID)
        await writeFile(join(project, 'search.txt'), 'needle\n')
        const shell = await tools.shell!.execute({ command: 'printf shell-ok', path: project }, context())
        expect((shell.output as any).stdout).toBe('shell-ok')
        expect(((await tools.glob!.execute({ path: project, pattern: '*.txt' }, context())).output as string[])).toContain('search.txt')
        const grep = await tools.grep!.execute({ path: project, pattern: 'needle' }, context())
        expect((grep.output as any[]).some(event => event.data?.lines?.text === 'needle\n')).toBe(true)
    })

    it('fetches an HTTP page', async () => {
        const server = Bun.serve({ port: 0, fetch: () => new Response('web-ok') })
        const tools = await Tool.list(sessionID)
        const result = await tools.web_fetch!.execute({ url: `http://127.0.0.1:${server.port}` }, context())
        server.stop()
        expect((result.output as any).body).toBe('web-ok')
    })
})
