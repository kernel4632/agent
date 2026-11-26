import { afterEach, describe, expect, test } from 'bun:test'
import { dataDir, restoreHome, script, tools, tool } from './mock.js'
import { Agents } from '../features/Agents.js'
import { Models } from '../features/Models.js'
import { Stream } from '../features/Stream.js'
import { Store } from '../features/Store.js'
import { Extension } from '../features/Extension.js'

const original = process.env.AGENT_HOME
const undos = []

function use(model, extra = {}) {
    dataDir()
    undos.push(Extension.patch(Models, 'resolve', () => () => ({ model, stream: false, ...extra })))
}

afterEach(async () => {
    try {
        Agents.get('main')?.agent.stop()
        await Promise.race([Agents.done('main').catch(() => {}), Bun.sleep(200)])
    } finally {
        Agents.drop('main')
        for (const undo of undos.splice(0).reverse()) undo()
        restoreHome(original)
    }
})

function collect(id = 'main') {
    const events = []
    const unsub = Stream.subscribe(id, (name, data) => events.push({ name, ...typeof data === 'object' ? data : { data } }))
    return { events, unsub }
}

describe('Agents', () => {
    test('没有配置模型时仍能打开会话，发送会被拦住并说明原因', async () => {
        dataDir()
        await Agents.open('main')
        expect(Agents.snapshot('main').fault).toContain('未配置模型')
        await expect(Agents.send('main', { input: 'hi' })).rejects.toThrow('未配置模型')
        expect(Agents.get('main').agent.history).toEqual([])
    })

    test('send 的事件顺序：先 run start，用户消息写入后才请求，结束有 message 和 run end', async () => {
        const { model } = script([{ text: '你好' }])
        use(model)
        const { events, unsub } = collect()
        await Agents.open('main')
        await Agents.send('main', { input: 'hi' })
        await Agents.done('main')
        unsub()
        const types = events.map(event => event.name === 'core' ? event.type : `run:${event.state}`)
        expect(types).toEqual(['run:start', 'message', 'request-start', 'request-end', 'message', 'step', 'run:end'])
        expect(events.filter(event => event.type === 'message').map(event => event.message.role)).toEqual(['user', 'assistant'])
        const history = Agents.get('main').agent.history
        expect(history.map(message => message.role)).toEqual(['user', 'assistant'])
        expect(events.find(event => event.type === 'message' && event.message.role === 'user').message.id).toBe(history[0].id)
    })

    test('正在运行时再 send 返回 409；停掉之后可以继续', async () => {
        let release
        const wait = new Promise(resolve => { release = resolve })
        const { model } = script([async () => { await wait; return { text: '好' } }])
        use(model)
        await Agents.open('main')
        await Agents.send('main', { input: 'hi' })
        expect(Agents.running('main')).toBe(true)
        try { await Agents.send('main', { input: 'again' }); throw new Error('should fail') } catch (error) { expect(error.status).toBe(409) }
        release()
        await Agents.done('main')
        await Agents.send('main', { input: 'again' })
        await Agents.done('main')
        expect(Agents.get('main').agent.history.filter(message => message.role === 'user')).toHaveLength(2)
    })

    test('stop 会结束正在跑的请求，推 run stopped，历史里留下用户消息', async () => {
        let release
        const wait = new Promise(resolve => { release = resolve })
        const { model } = script([async () => { await wait; return { text: '好' } }])
        use(model)
        const { events, unsub } = collect()
        await Agents.open('main')
        await Agents.send('main', { input: 'hi' })
        const stopped = await Agents.stop('main')
        unsub()
        expect(stopped.stopped).toBe(true)
        expect(stopped.wasRunning).toBe(true)
        expect(events.some(event => event.name === 'run' && event.state === 'stopped')).toBe(true)
        expect(Agents.get('main').agent.history.map(message => message.role)).toEqual(['user'])
        release()
    })

    test('不带 input 的 send 是继续；cut 截到该消息之前并重写落盘', async () => {
        const { model } = script([{ text: '一' }, { text: '二' }, { text: '三' }])
        use(model)
        await Agents.send('main', { input: '第一句' })
        await Agents.done('main')
        const first = Agents.get('main').agent.history[0].id
        await Agents.send('main', { input: '第二句' })
        await Agents.done('main')
        expect(Agents.get('main').agent.history.filter(message => message.role === 'user')).toHaveLength(2)
        await Agents.send('main')
        await Agents.done('main')
        expect(Agents.get('main').agent.history.at(-1).content).toEqual([{ type: 'text', text: '三' }])
        const { events, unsub } = collect()
        await Agents.cut('main', first)
        unsub()
        expect(Agents.get('main').agent.history).toEqual([])
        expect(await Store.history('main')).toEqual([])
        expect(events.some(event => event.name === 'cut' && Array.isArray(event.history) && event.history.length === 0)).toBe(true)
    })

    test('手动压缩把总结写入历史；落盘后再 open 能读回相同 id', async () => {
        const { model } = script([{ text: '你好' }, { text: '这是总结' }])
        use(model)
        await Agents.send('main', { input: 'hi' })
        await Agents.done('main')
        const before = Agents.get('main').agent.history.map(message => message.id)
        await Agents.compact('main')
        await Agents.done('main')
        const compact = Agents.get('main').agent.history.at(-1)
        expect(compact.role).toBe('compact')
        expect(compact.content).toBe('这是总结')
        const ids = Agents.get('main').agent.history.map(message => message.id)
        expect(ids.slice(0, before.length)).toEqual(before)
        Agents.drop('main')
        const again = await Agents.open('main')
        expect(again.agent.history.map(message => message.id)).toEqual(ids)
        expect(again.agent.history.at(-1).content).toBe('这是总结')
    })

    test('工具调用边写边推，结果落盘后能再读出来', async () => {
        const dir = tools({ 'a.ts': tool('a', 'return 1') })
        const { model } = script([{ calls: [{ name: 'a', id: 'c1', input: { x: 1 } }] }, { text: '好' }])
        use(model, { tools: [dir], noToolRounds: 1 })
        const { events, unsub } = collect()
        await Agents.send('main', { input: 'hi' })
        await Agents.done('main')
        unsub()
        const types = events.filter(event => event.name === 'core').map(event => event.type)
        expect(types).toContain('tool-call')
        expect(types).toContain('tool-run')
        expect(types).toContain('tool-result')
        const roles = Agents.get('main').agent.history.map(message => message.role)
        expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant'])
        Agents.drop('main')
        expect((await Agents.open('main')).agent.history.map(message => message.role)).toEqual(roles)
    })
})
