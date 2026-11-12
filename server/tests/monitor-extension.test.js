/*
 * 监控唤醒扩展测试：验证条件判定、工具挂载、无打扰排队与唤醒机制。
 *
 * 运行方式：
 *   cd server && bun test tests/monitor-extension.test.js
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import Path from '../utils/path.js'
import store from '../store.js'
import Chat from '../commands/chat.js'
import History from '../features/history.js'
import Tool from '../features/tool.js'
import Extension from '../features/extension.js'


const { default: MonitorEngine } = await import('../../extensions/monitor/engine.js')
const { default: MonitorTool } = await import('../../extensions/monitor/tool.js')
const { default: ProcessCondition } = await import('../../extensions/monitor/conditions/process.js')
const { default: FileCondition } = await import('../../extensions/monitor/conditions/file.js')
const { default: TimerCondition } = await import('../../extensions/monitor/conditions/timer.js')
const { default: CommandCondition } = await import('../../extensions/monitor/conditions/command.js')
const { default: monitorBackend } = await import('../../extensions/monitor/backend.js')
const homes = []
const withHome = async callback => {
    const root = join(tmpdir(), `agent-mon-${crypto.randomUUID()}`)
    homes.push(root)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)
    Object.keys(store.config).forEach(key => delete store.config[key])
    try {
        return await callback(root)
    } finally {
        MonitorEngine.stop()
        Path.unlock()
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
    }
}

afterEach(async () => {
    MonitorEngine.stop()
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('条件模块单元判定', () => {
    test('timer 条件倒计时与到期判定', async () => {
        const spec = TimerCondition.normalize({ afterSeconds: 2 })
        const state = await TimerCondition.start(spec)

        // 未到达时间不触发
        const unreached = await TimerCondition.check(spec, state)
        expect(unreached.fired).toBe(false)

        // 模拟时间到达
        const reached = await TimerCondition.check(spec, { targetAt: Date.now() - 100 })
        expect(reached.fired).toBe(true)
        expect(reached.evidence).toContain('定时时间到达')
    })

    test('file 条件支持 create/change/delete/match', async () => {
        const dir = join(tmpdir(), `file-test-${crypto.randomUUID()}`)
        await mkdir(dir, { recursive: true })
        const target = join(dir, 'test.txt')

        try {
            // 1. 等待创建
            const createSpec = FileCondition.normalize({ path: target, on: 'create' }, { cwd: dir })
            const createState = await FileCondition.start(createSpec)
            expect((await FileCondition.check(createSpec, createState)).fired).toBe(false)

            await writeFile(target, 'hello world\n')
            expect((await FileCondition.check(createSpec, createState)).fired).toBe(true)

            // 2. 匹配内容
            const matchSpec = FileCondition.normalize({ path: target, on: 'match', pattern: 'world' }, { cwd: dir })
            const matchState = await FileCondition.start(matchSpec)
            const matchRes = await FileCondition.check(matchSpec, matchState)
            expect(matchRes.fired).toBe(true)
            expect(matchRes.evidence).toContain('第 1 行命中规则 "world"')

            // 3. 等待删除
            const deleteSpec = FileCondition.normalize({ path: target, on: 'delete' }, { cwd: dir })
            const deleteState = await FileCondition.start(deleteSpec)
            expect((await FileCondition.check(deleteSpec, deleteState)).fired).toBe(false)

            await rm(target)
            expect((await FileCondition.check(deleteSpec, deleteState)).fired).toBe(true)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    test('command 条件检测退出码与输出匹配', async () => {
        const zeroSpec = CommandCondition.normalize({ command: 'echo OK', fireWhen: 'exit_zero' })
        const zeroRes = await CommandCondition.check(zeroSpec)
        expect(zeroRes.fired).toBe(true)
        expect(zeroRes.evidence).toContain('OK')

        const matchSpec = CommandCondition.normalize({ command: 'echo READY_123', fireWhen: 'output_match', pattern: 'READY_123' })
        const matchRes = await CommandCondition.check(matchSpec)
        expect(matchRes.fired).toBe(true)
    })
})

describe('Monitor 工具与调度流转', () => {
    test('start / list / stop 完整流程', () => withHome(async () => {
        const sessionId = 'test-session-1'
        store.sessions[sessionId] = { id: sessionId, cwd: tmpdir(), running: false }

        // 1. start
        const startRes = await MonitorTool.execute({
            action: 'start',
            condition: { kind: 'timer', afterSeconds: 60 },
            objective: '等待任务完成并汇报',
            name: '定时监控',
        }, { sessionId })

        expect(startRes.monitorId).toBe('m1')
        expect(startRes.message).toContain('已成功挂载监控 [m1]')

        // 2. list
        const listRes = await MonitorTool.execute({ action: 'list' }, { sessionId })
        expect(listRes.count).toBe(1)
        expect(listRes.monitors[0].id).toBe('m1')
        expect(listRes.monitors[0].objective).toBe('等待任务完成并汇报')

        // 3. stop
        const stopRes = await MonitorTool.execute({ action: 'stop', id: 'm1' }, { sessionId })
        expect(stopRes.stopped).toEqual(['m1'])

        const listResAfter = await MonitorTool.execute({ action: 'list' }, { sessionId })
        expect(listResAfter.count).toBe(0)
    }))

    test('全程不打断：会话 running 处于忙碌态时排队，待空闲时才唤醒', () => withHome(async () => {
        const sessionId = 'busy-session-1'
        let chatSent = false
        let chatInput = ''

        // mock Chat.send
        const originalSend = Chat.send
        Chat.send = async ({ sessionId: id, input }) => {
            chatSent = true
            chatInput = input
        }

        try {
            store.sessions[sessionId] = { id: sessionId, cwd: tmpdir(), running: true } // 处于忙碌运行中！

            // 挂载监控
            const { monitor } = await MonitorEngine.arm({
                sessionId,
                condition: { kind: 'timer', afterSeconds: 1 },
                objective: '构建验证',
                repeat: false,
            })

            // 推进时间到期
            monitor.nextCheckAt = Date.now() - 100
            monitor.conditionState = { targetAt: Date.now() - 100 }

            MonitorEngine.start()

            // 等待一轮 tick 执行
            await new Promise(r => setTimeout(r, 1100))

            // 因为 running 为 true，绝不打断当前运行！Chat.send 不应被触发
            expect(chatSent).toBe(false)
            expect(monitor.status).toBe('pending_wake')

            // 模拟当前会话运行结束，变为空闲状态
            store.sessions[sessionId].running = false

            // 下一轮 tick 应当感知空闲并触发唤醒
            await new Promise(r => setTimeout(r, 1100))

            expect(chatSent).toBe(true)
            expect(chatInput).toContain('<goal_round>')
            expect(chatInput).toContain('Objective: "构建验证"')
        } finally {
            Chat.send = originalSend
        }
    }))
})

describe('后端集成扩展 patch', () => {
    test('backend.js 成功将 monitor 工具注入 Tool 并设置 never 审批', async () => {
        const patchedFns = new Map()
        const fakeCtx = {
            patch: (obj, key, wrapper) => {
                const orig = obj[key]
                const wrapped = wrapper(orig)
                obj[key] = wrapped
                patchedFns.set(key, { obj, orig })
            },
            op: () => {},
            onDispose: () => {},
        }

        try {
            monitorBackend(fakeCtx)
            expect(Tool.kind({ toolName: 'monitor' })).toBe('never')
            const list = await Tool.list()
            expect(list.some(t => t.name === 'monitor')).toBe(true)
        } finally {
            for (const [key, { obj, orig }] of patchedFns) {
                obj[key] = orig
            }
        }
    })
})
