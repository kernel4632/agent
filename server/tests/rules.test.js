/*
 * 项目规则注入测试：会话目录里的 AGENTS.md 要拼进 system，文件变了要跟着变。
 *
 * 覆盖：没有规则时只有用户提示词；AGENTS.md 优先于 CLAUDE.md；
 * 缓存按修改时间失效；Agent.resolve 和 Agent.create 端到端注入。
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Agent from '../features/agent.js'
import Context from '../features/context.js'
import Session from '../commands/session.js'
import store from '../store.js'
import '../server.js'

const provider = [{ name: 'local', models: [{ id: 'model', name: 'model' }] }]

// 开一个临时 AGENT_HOME 和一个临时工作区目录，cwd 里的规则文件按测试需要现场写。
const withRules = async callback => {
    const home = join(tmpdir(), `agent-rules-home-${crypto.randomUUID()}`)
    const cwd = join(tmpdir(), `agent-rules-cwd-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = home
    await mkdir(home, { recursive: true })
    await mkdir(cwd, { recursive: true })
    Object.keys(store.config).forEach(key => delete store.config[key])
    store.config.providers = structuredClone(provider)
    try {
        return await callback({ home, cwd, write: (name, text) => writeFile(join(cwd, name), text) })
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(home, { recursive: true, force: true })
        await rm(cwd, { recursive: true, force: true })
    }
}

const resolve = async ({ cwd }) => Agent.resolve({
    session: { cwd, model: { provider: 'local', model: 'model' } },
    settings: Agent.defaultSettings(),
})

describe('项目规则', () => {
    test('没有规则文件时 system 是用户提示词加压缩规范', async () => {
        await withRules(async ({ write }) => {
            const result = await Context.systemFor({ config: { prompt: { system: '我的提示词' } }, cwd: join(tmpdir(), '不存在的目录') })
            expect(result).toContain('我的提示词')
            expect(result).toContain('上下文压缩')
        })
    })

    test('AGENTS.md 的内容拼在用户提示词后面', async () => {
        await withRules(async ({ cwd, write }) => {
            await write('AGENTS.md', '# 规则\n\n每改完一点就提交。')
            const result = await Context.systemFor({ config: { prompt: { system: '我的提示词' } }, cwd })
            expect(result).toContain('我的提示词')
            expect(result).toContain('每改完一点就提交。')
            expect(result.indexOf('我的提示词')).toBeLessThan(result.indexOf('每改完一点就提交。'))
        })
    })

    test('AGENTS.md 不在时看 CLAUDE.md', async () => {
        await withRules(async ({ cwd, write }) => {
            await write('CLAUDE.md', 'claude 的规则')
            const result = await Context.systemFor({ config: { prompt: { system: '' } }, cwd })
            expect(result).toContain('claude 的规则')
        })
    })

    test('文件变了下次读取就是新的，不用重启', async () => {
        await withRules(async ({ cwd, write }) => {
            await write('AGENTS.md', '第一版')
            expect(await Context.systemFor({ config: {}, cwd })).toContain('第一版')
            // 同一毫秒内的改写在 Windows 上 mtime 相同，等过这一毫秒再改。
            await new Promise(resolve => setTimeout(resolve, 20))
            await write('AGENTS.md', '第二版')
            expect(await Context.systemFor({ config: {}, cwd })).toContain('第二版')
        })
    })

    test('Agent.resolve 注入完整 system', async () => {
        await withRules(async ({ cwd, write }) => {
            await write('AGENTS.md', 'resolve 里的规则')
            const config = await resolve({ cwd })
            expect(config.system).toContain('resolve 里的规则')
        })
    })

    test('Agent.create 装配的实例带着目录规则，移动目录后按新目录刷新', async () => {
        await withRules(async ({ cwd, write }) => {
            await write('AGENTS.md', '装配时的规则')
            const { sessionId } = await Session.create({ title: '规则', cwd })
            const agent = await Agent.get({ sessionId })
            expect(agent.config.system).toContain('装配时的规则')
            // 压缩规范跟着装配后的 system 走，自动压缩才拿得到。
            expect(agent.config.system).toContain('上下文压缩')

            await write('AGENTS.md', '改过之后的规则')
            await new Promise(resolve => setTimeout(resolve, 20))
            const again = await Agent.get({ sessionId })
            expect(again.config.system).toContain('改过之后的规则')
            expect(again.config.system).toContain('上下文压缩')
        })
    })
})
