import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataDir, restoreHome } from './mock.js'
import { Loader } from '../features/Loader.js'
import { Extension } from '../features/Extension.js'
import { Models } from '../features/Models.js'
import { create, wire } from '../server.js'

const original = process.env.AGENT_HOME
const servers = []

function folder(root, name, manifest, files = {}) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name, version: '1.0.0', base: 1, ...manifest }))
    for (const [path, source] of Object.entries(files)) {
        mkdirSync(join(dir, path, '..'), { recursive: true })
        writeFileSync(join(dir, path), source)
    }
    return dir
}

afterEach(async () => {
    Loader.reset()
    for (const server of servers.splice(0)) server.stop(true)
    restoreHome(original)
})

describe('Loader', () => {
    test('按 requires 拓扑启动，after 只是软边，缺依赖的不启动', async () => {
        const root = mkdtempSync(join(tmpdir(), 'ext-'))
        folder(root, 'base', {}, { 'backend.js': 'export default ctx => { ctx.expose({ ok: true }) }' })
        folder(root, 'child', { requires: ['base'] }, { 'backend.js': 'export default ctx => { if (!ctx.use("base")) throw new Error("no base") }' })
        folder(root, 'late', { after: ['missing'] }, { 'backend.js': 'export default ctx => { ctx.expose({ late: true }) }' })
        folder(root, 'orphan', { requires: ['nobody'] }, { 'backend.js': 'export default ctx => { ctx.expose({ no: true }) }' })
        const list = await Loader.start({ roots: [root] })
        const by = Object.fromEntries(list.map(item => [item.name, item]))
        expect(by.base.error).toBeUndefined()
        expect(by.child.error).toBeUndefined()
        expect(by.late.error).toBeUndefined()
        expect(by.orphan.error).toContain('缺少依赖')
        expect(Extension.invoke).toBeTypeOf('function')
    })

    test('循环依赖记原因，不启动', async () => {
        const root = mkdtempSync(join(tmpdir(), 'ext-'))
        folder(root, 'a', { requires: ['b'] }, { 'backend.js': 'export default () => {}' })
        folder(root, 'b', { requires: ['a'] }, { 'backend.js': 'export default () => {}' })
        const list = await Loader.start({ roots: [root] })
        expect(list.every(item => item.error === '循环依赖')).toBe(true)
    })

    test('启动失败只撤自己，其他扩展继续', async () => {
        const root = mkdtempSync(join(tmpdir(), 'ext-'))
        folder(root, 'ok', {}, { 'backend.js': 'export default ctx => { ctx.patch(ctx.Models, "list", original => (...args) => [...original(...args), { id: "ok" }]) }' })
        folder(root, 'bad', {}, { 'backend.js': 'export default () => { throw new Error("炸了") }' })
        Loader.bind({ targets: { Models } })
        const list = await Loader.start({ roots: [root] })
        const by = Object.fromEntries(list.map(item => [item.name, item]))
        expect(by.bad.error).toContain('炸了')
        expect(by.ok.error).toBeUndefined()
        expect(Models.list({ providers: [] }).some(item => item.id === 'ok')).toBe(true)
        Loader.stop('ok')
        expect(Models.list({ providers: [] }).some(item => item.id === 'ok')).toBe(false)
    })

    test('关闭名单和协议版本不对的会跳过', async () => {
        const root = mkdtempSync(join(tmpdir(), 'ext-'))
        folder(root, 'off', {}, { 'backend.js': 'export default ctx => { ctx.expose({ ran: true }) }' })
        folder(root, 'old', { base: 99 }, { 'backend.js': 'export default ctx => { ctx.expose({ ran: true }) }' })
        const list = await Loader.start({ roots: [root], disabled: ['off'] })
        const by = Object.fromEntries(list.map(item => [item.name, item]))
        expect(by.off.error).toBe('已关闭')
        expect(by.old.error).toContain('不匹配')
        expect(Extension.invoke('missing', {})).rejects.toThrow()
    })

    test('打包并提供前端入口，inspect 能看到谁包了哪个方法', async () => {
        dataDir()
        wire()
        const root = mkdtempSync(join(tmpdir(), 'ext-'))
        folder(root, 'ui', {}, {
            'backend.js': 'export default ctx => { ctx.patch(ctx.Store, "config", original => original) }',
            'frontend/index.js': 'export default app => { app.ready = true }\n',
        })
        await Loader.start({ roots: [root] })
        const entries = Loader.entries()
        expect(entries[0].name).toBe('ui')
        expect(entries[0].url).toContain('/api/extensions/ui/frontend.js')
        const info = Loader.inspect()
        expect(info.patches.some(item => item.method === 'config' && item.owners.includes('ui'))).toBe(true)
        const server = create({ port: 0 })
        servers.push(server)
        const response = await fetch(`${server.url}api/extensions/ui/frontend.js`)
        const code = await response.text()
        expect(response.ok).toBe(true)
        expect(code).toContain('__agentVue__')
        expect(code).toContain('app.ready')
    })
})
