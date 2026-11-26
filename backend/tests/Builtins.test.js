import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataDir, restoreHome, script } from './mock.js'
import { Agents } from '../features/Agents.js'
import { Models } from '../features/Models.js'
import { Stream } from '../features/Stream.js'
import { Store } from '../features/Store.js'
import { Extension } from '../features/Extension.js'
import { Loader } from '../features/Loader.js'
import { wire } from '../server.js'

const original = process.env.AGENT_HOME
const builtins = join(import.meta.dir, '../../extensions')
const undos = []

async function boot(model, extra = {}) {
    const dir = dataDir()
    wire()
    await Store.configure({ providers: [], models: { chat: 'mock/x', compact: '' }, noToolRounds: 1, retryMaxTries: 0, requestTimeout: 15 })
    undos.push(Extension.patch(Models, 'resolve', () => () => ({ model, stream: false, ...extra })))
    await Loader.start({ roots: [builtins] })
    return dir
}

afterEach(async () => {
    try {
        for (const current of Agents.all()) current.agent.stop()
        await Promise.race([Promise.all(Agents.all().map(current => Agents.done(current.agent.id).catch(() => {}))), Bun.sleep(200)])
    } finally {
        for (const current of [...Agents.all()]) Agents.drop(current.agent.id)
        Loader.reset()
        for (const undo of undos.splice(0).reverse()) undo()
        restoreHome(original)
    }
})

describe('内置扩展', () => {
    test('默认全部启动，并挂上基础工具', async () => {
        const { model } = script([{ text: 'ok' }])
        await boot(model)
        const names = Loader.list().map(item => item.name)
        for (const name of ['shell', 'settings', 'session', 'tools', 'permission', 'skill', 'todo', 'mcp', 'title']) {
            const item = Loader.list().find(one => one.name === name)
            expect(item, name).toBeDefined()
            expect(item.error, `${name}: ${item?.error}`).toBeUndefined()
        }
        const paths = Extension.paths().join(' ')
        expect(paths).toContain('read_file.js')
        expect(paths).toContain('finish.js')
        expect(paths).toContain('shell.js')
        expect(paths).toContain('todo.js')
        expect(paths).toContain('skill.js')
    })

    test('会话增删改名、设置读写', async () => {
        const { model } = script([{ text: 'ok' }])
        await boot(model)
        const created = await Extension.invoke('session.create', { title: '草稿', group: '工作' })
        expect(created.title).toBe('草稿')
        const listed = await Extension.invoke('session.list', { query: '草' })
        expect(listed.some(item => item.id === created.id)).toBe(true)
        const renamed = await Extension.invoke('session.rename', { id: created.id, title: '已命名' })
        await Extension.invoke('session.group', { id: created.id, group: '工作' })
        expect((await renamed).title ?? renamed.title).toBe('已命名')
        const grouped = await Extension.invoke('session.list', { group: '工作' })
        expect(grouped.some(item => item.id === created.id && item.group === '工作')).toBe(true)
        const config = await Extension.invoke('settings.set', { key: 'models.chat', value: 'mock/x' })
        expect(config.models.chat).toBe('mock/x')
        await Extension.invoke('session.delete', { id: created.id })
        const after = await Extension.invoke('session.list', {})
        expect(after.some(item => item.id === created.id)).toBe(false)
    })

    test('第一条用户消息自动成为标题，finish 能结束循环', async () => {
        const { model } = script([
            { text: '先说一句', calls: [{ id: 'f1', name: 'finish', input: { summary: '好了' } }] },
            { text: '不该再来一轮' },
        ])
        await boot(model)
        const { id } = await Extension.invoke('session.create', { title: '新会话' })
        await Agents.open(id)
        await Agents.send(id, { input: '请帮我写一份出行计划' })
        await Agents.done(id)
        const meta = await Store.meta(id)
        expect(meta.title).toBe('请帮我写一份出行计划')
        const history = Agents.get(id).agent.history
        const texts = history.filter(item => item.role === 'assistant').flatMap(item => Array.isArray(item.content) ? item.content.filter(part => part.type === 'text').map(part => part.text) : [item.content])
        expect(texts.join('')).toContain('先说一句')
        expect(texts.join('')).not.toContain('不该再来一轮')
    })

    test('权限扩展会拦住需要询问的工具，回答后才执行', async () => {
        const target = join(tmpdir(), `agent-note-${Date.now()}.txt`)
        const { model } = script([
            { calls: [{ id: 'c1', name: 'write_file', input: { path: target, content: 'hi' } }] },
            { text: '写好了', calls: [{ id: 'c2', name: 'finish', input: { summary: '写好了' } }] },
        ])
        await boot(model)
        const { id } = await Extension.invoke('session.create', { title: '新会话' })
        const asks = []
        const unsub = Stream.subscribe(id, (name, data) => { if (name === 'permission.ask') asks.push(data) })
        await Agents.open(id)
        await Agents.send(id, { input: '写个文件' })
        const started = Date.now()
        while (!asks.length && Date.now() - started < 4000) await Bun.sleep(20)
        expect(asks.length).toBeGreaterThan(0)
        expect(asks[0].call.toolName).toBe('write_file')
        await Extension.invoke('permission.answer', { requestId: asks[0].requestId, allow: true })
        await Agents.done(id)
        unsub()
        const history = Agents.get(id).agent.history
        const results = history.filter(item => item.role === 'tool')
        expect(results.length).toBeGreaterThan(0)
    })

    test('技能扫描和待办读写走 op，不碰真模型', async () => {
        const { model } = script([{ text: 'ok' }])
        const dir = await boot(model)
        mkdirSync(join(dir, 'skills', 'demo'), { recursive: true })
        writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), '# 演示\n这是一个测试技能。\n')
        const skills = await Extension.invoke('skill.list', {})
        expect(skills.some(item => item.name === 'demo')).toBe(true)
        const { id } = await Extension.invoke('session.create', { title: '新会话' })
        expect((await Extension.invoke('todo.list', { id })).items).toEqual([])
        const mcp = await Extension.invoke('mcp.save', { mcp: [{ name: 'x', url: 'https://example.com', enabled: false }] })
        expect(mcp[0].name).toBe('x')
        expect((await Extension.invoke('mcp.list', {})).list[0].url).toBe('https://example.com')
    })
})
