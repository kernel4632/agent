import { afterEach, describe, expect, test } from 'bun:test'
import { dataDir, holdable, restoreHome, script } from './mock.js'
import { Agents } from '../features/Agents.js'
import { Models } from '../features/Models.js'
import { Stream } from '../features/Stream.js'
import { Extension } from '../features/Extension.js'
import { create } from '../server.js'

const original = process.env.AGENT_HOME
const undos = []
const servers = []

function use(model, extra = {}) {
    dataDir()
    undos.push(Extension.patch(Models, 'resolve', () => () => ({ model, ...extra })))
}

afterEach(async () => {
    try {
        Agents.peek('main')?.agent.stop()
        await Promise.race([Agents.done('main').catch(() => {}), Bun.sleep(200)])
    } finally {
        Agents.drop('main')
        for (const undo of undos.splice(0).reverse()) undo()
        for (const server of servers.splice(0)) server.stop(true)
        restoreHome(original)
    }
})

function session(response) {
    const events = []
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    return {
        events,
        async wait(until) {
            if (until(events)) return events
            while (true) {
                const { value, done } = await reader.read()
                if (done) return events
                buffer += decoder.decode(value, { stream: true })
                const parts = buffer.split('\n\n')
                buffer = parts.pop()
                for (const part of parts) {
                    const name = part.match(/^event: (.+)$/m)?.[1]
                    const data = part.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
                    if (!name || !data) continue
                    events.push({ name, data: JSON.parse(data) })
                    if (until(events)) return events
                }
            }
        },
        close() { return reader.cancel().catch(() => {}) },
    }
}

describe('Stream 尾巴', () => {
    test('相邻同类片段会合并；写入历史后尾巴清空', () => {
        Stream.clear('t')
        Stream.feed('t', { type: 'request-start', model: 'm', start: 1, attempt: 1 })
        Stream.feed('t', { type: 'text', text: '你' })
        Stream.feed('t', { type: 'text', text: '好' })
        Stream.feed('t', { type: 'reasoning', text: '想' })
        Stream.feed('t', { type: 'reasoning', text: '想' })
        Stream.feed('t', { type: 'tool-input', toolCallId: 'c1', delta: '{"x"' })
        Stream.feed('t', { type: 'tool-input', toolCallId: 'c1', delta: ':1}' })
        Stream.feed('t', { type: 'tool-output', toolCallId: 'c1', stream: 'stdout', data: 'a' })
        Stream.feed('t', { type: 'tool-output', toolCallId: 'c1', stream: 'stdout', data: 'b' })
        expect(Stream.tail('t')).toEqual([
            { type: 'request-start', model: 'm', start: 1, attempt: 1 },
            { type: 'text', text: '你好' },
            { type: 'reasoning', text: '想想' },
            { type: 'tool-input', toolCallId: 'c1', delta: '{"x":1}' },
            { type: 'tool-output', toolCallId: 'c1', stream: 'stdout', data: 'ab' },
        ])
        Stream.feed('t', { type: 'message', message: { id: 'a', role: 'assistant', content: [] } })
        expect(Stream.tail('t')).toEqual([])
        Stream.clear('t')
    })

    test('request-error 带 delay 时记下 retryUntil，新的 request-start 清掉它', () => {
        Stream.clear('t')
        const before = Date.now()
        Stream.feed('t', { type: 'request-error', attempt: 1, error: { kind: 'server', message: '忙' }, retry: { delay: 1000 } })
        expect(Stream.retry('t')).toBeGreaterThanOrEqual(before + 1000)
        Stream.feed('t', { type: 'request-start', model: 'm', start: 2, attempt: 2 })
        expect(Stream.retry('t')).toBeUndefined()
        Stream.clear('t')
    })
})

describe('刷新和多页签', () => {
    test('两个订阅者看到同一份事件；连上先发快照', async () => {
        const { model } = script([{ text: '你好' }])
        use(model, { stream: false })
        const server = create({ port: 0 })
        servers.push(server)
        const [a, b] = await Promise.all([fetch(`${server.url}api/agent/main/stream`), fetch(`${server.url}api/agent/main/stream`)])
        const left = session(a)
        const right = session(b)
        await Promise.all([left.wait(events => events.some(event => event.name === 'snapshot')), right.wait(events => events.some(event => event.name === 'snapshot'))])
        expect(left.events[0].data.history).toEqual([])
        expect(left.events[0].data.running).toBe(false)
        const post = await fetch(`${server.url}api/agent/main/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'hi' }) })
        expect(post.status).toBe(202)
        const ended = events => events.some(event => event.name === 'run' && event.data.state === 'end')
        await Promise.all([left.wait(ended), right.wait(ended)])
        const types = list => list.filter(event => event.name === 'core' || event.name === 'run').map(event => event.name === 'core' ? event.data.type : `run:${event.data.state}`)
        expect(types(left.events)).toEqual(types(right.events))
        expect(types(left.events)).toContain('run:start')
        expect(types(left.events)).toContain('message')
        expect(types(left.events).at(-1)).toBe('run:end')
        await Promise.all([left.close(), right.close()])
    })

    test('请求进行中重连：快照带上已保存历史和合并后的尾巴，不会重放全部片段', async () => {
        const { model, resume } = holdable('你好世界')
        use(model)
        const server = create({ port: 0 })
        servers.push(server)
        const live = session(await fetch(`${server.url}api/agent/main/stream`))
        await live.wait(events => events.some(event => event.name === 'snapshot'))
        const send = fetch(`${server.url}api/agent/main/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'hi' }) })
        await live.wait(events => events.some(event => event.name === 'core' && event.data.type === 'text'))
        // 此时前半段已经流出，后半段还没写完。新连接应该看到用户消息 + 合并后的正文尾巴。
        const replay = session(await fetch(`${server.url}api/agent/main/stream`))
        await replay.wait(events => events[0]?.name === 'snapshot')
        const data = replay.events[0].data
        expect(data.running).toBe(true)
        expect(data.history.map(message => message.role)).toEqual(['user'])
        const texts = data.tail.filter(event => event.type === 'text')
        expect(texts).toHaveLength(1)
        expect(texts[0].text.length).toBeGreaterThan(0)
        expect(texts[0].text.length).toBeLessThan('你好世界'.length)
        expect(data.tail.some(event => event.type === 'request-start')).toBe(true)
        resume()
        await send
        await Agents.done('main')
        await Promise.all([live.close(), replay.close()])
    })

    test('正在运行时 POST send 返回 409；进程式重启（drop 后再 open）不会自动续跑', async () => {
        let release
        const wait = new Promise(resolve => { release = resolve })
        const { model } = script([async () => { await wait; return { text: '好' } }])
        use(model, { stream: false })
        const server = create({ port: 0 })
        servers.push(server)
        await Agents.open('main')
        await Agents.send('main', { input: 'hi' })
        const conflict = await fetch(`${server.url}api/agent/main/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'again' }) })
        expect(conflict.status).toBe(409)
        await Agents.stop('main')
        Agents.drop('main')
        const opened = await Agents.open('main')
        expect(Agents.running('main')).toBe(false)
        expect(opened.agent.history.at(-1)?.role).not.toBe('assistant')
        const snapshot = Agents.snapshot('main')
        expect(snapshot.running).toBe(false)
        expect(snapshot.tail).toEqual([])
        release()
    })
})
