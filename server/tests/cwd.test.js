/*
 * 目录测试：cwd 是会话的属性，不是工作区；移动目录不丢历史。
 *
 * 这里看两件事：文件工具按各会话自己的目录算相对路径；移动后重启还能读回来。
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Agent from '../features/agent.js'
import Config from '../commands/config.js'
import History from '../features/history.js'
import Session from '../commands/session.js'
import store from '../store.js'
import { app } from '../server.js'

const withHome = async callback => {
    const root = join(tmpdir(), `agent-cwd-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Object.keys(store.config).forEach(key => delete store.config[key])
    Agent.runtime().clear()
    History.clear()
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

describe('会话当前目录', () => {
    test('两条会话各自的文件工具互不影响', async () => {
        await withHome(async root => {
            const first = join(root, 'first')
            const second = join(root, 'second')
            await mkdir(first, { recursive: true })
            await mkdir(second, { recursive: true })
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })

            const a = await Session.create({ title: 'A', cwd: first })
            const b = await Session.create({ title: 'B', cwd: second })
            await Agent.runtime().get(a.sessionId).tools.handlers.write_to_file.execute({ path: 'note.txt', content: 'A' })
            await Agent.runtime().get(b.sessionId).tools.handlers.write_to_file.execute({ path: 'note.txt', content: 'B' })

            expect(await Bun.file(join(first, 'note.txt')).text()).toBe('A')
            expect(await Bun.file(join(second, 'note.txt')).text()).toBe('B')
        })
    })

    test('cwd 工具移动会话，之前的对话还在，重启后目录也还在', async () => {
        await withHome(async root => {
            const target = join(root, 'moved')
            await mkdir(target, { recursive: true })
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const { sessionId } = await Session.create({ title: 'Move', cwd: root })
            await History.add({ sessionId, message: { id: 'u1', role: 'user', content: '第一句' } })
            await History.save(sessionId)

            const result = await Agent.runtime().get(sessionId).tools.handlers.cwd.execute({ path: target })
            expect(result).toContain(target)
            expect((await Session.read({ sessionId })).history).toHaveLength(1)

            // 模拟重启：内存清空，从磁盘读回来。
            History.clear()
            Agent.runtime().clear()
            expect((await Session.read({ sessionId })).cwd).toBe(target)
        })
    })

    test('HTTP 接口改目录，目录不存在时返回 400', async () => {
        await withHome(async root => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: 'HTTP cwd', cwd: root })
            const send = body => app.handle(new Request(`http://localhost/session/cwd/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            }))

            const ok = await send({ cwd: root })
            expect(ok.status).toBe(200)
            expect((await ok.json()).cwd).toBe(root)

            const bad = await send({ cwd: join(root, 'missing-folder') })
            expect(bad.status).toBe(400)
        })
    })

    test('命令工具默认在会话当前目录执行', async () => {
        await withHome(async root => {
            const work = join(root, 'work')
            await mkdir(work, { recursive: true })
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const { sessionId } = await Session.create({ title: 'Shell cwd', cwd: work })

            const result = await Agent.runtime().get(sessionId).tools.handlers.execute_command.execute({ command: 'cd' })
            expect(result.exitCode).toBe(0)
            expect(result.stdout.trim().toLowerCase()).toContain('work')
        })
    })
})
