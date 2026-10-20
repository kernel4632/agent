/*
 * 项目规则测试：AGENTS.md、规则目录、关闭开关和长度上限。
 *
 * 规则会进入 system，所以每条都看最终拼出来的文本，不只看文件读没读到。
 * 每个测试在自己的临时数据目录和工作区里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Config from '../commands/config.js'
import Rules from '../features/rules.js'
import Store from '../store.js'

// 每个测试使用独立数据目录，并把内存里的配置和规则清空。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-rules-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    await mkdir(root, { recursive: true })
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.rules = ''
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

describe('项目规则', () => {
    test('没有规则文件时返回空字符串', async () => {
        await withHome(async root => {
            expect(await Rules.read({ workspace: root, stopAt: root })).toBe('')
        })
    })

    test('读到 AGENTS.md 时带上来源标题', async () => {
        await withHome(async root => {
            await writeFile(join(root, 'AGENTS.md'), '用中文回答。')
            const text = await Rules.read({ workspace: root, stopAt: root })
            expect(text).toContain('AGENTS.md')
            expect(text).toContain('用中文回答。')
        })
    })

    test('从子目录出发会找到上级的 AGENTS.md，规则目录按项目根算', async () => {
        await withHome(async root => {
            const project = join(root, 'project')
            await mkdir(join(project, 'sub'), { recursive: true })
            await mkdir(join(project, '.agent', 'rules'), { recursive: true })
            await writeFile(join(project, 'AGENTS.md'), '项目规则A')
            await writeFile(join(project, '.agent', 'rules', 'style.md'), '风格规则B')

            const text = await Rules.read({ workspace: join(project, 'sub'), stopAt: root })
            expect(text).toContain('项目规则A')
            expect(text).toContain('风格规则B')
            expect(text).toContain('.agent/rules/style.md')
        })
    })

    test('.roo/rules 也认，和 .agent/rules 一起按路径排序', async () => {
        await withHome(async root => {
            await mkdir(join(root, '.agent', 'rules'), { recursive: true })
            await mkdir(join(root, '.roo', 'rules'), { recursive: true })
            await writeFile(join(root, '.agent', 'rules', 'a.md'), '自己的规则')
            await writeFile(join(root, '.roo', 'rules', 'b.md'), 'roo 的规则')

            const text = await Rules.read({ workspace: root, stopAt: root })
            expect(text).toContain('自己的规则')
            expect(text).toContain('roo 的规则')
            expect(text.indexOf('.agent/rules/a.md')).toBeLessThan(text.indexOf('.roo/rules/b.md'))
        })
    })

    test('模式专属规则只在对应模式下读取', async () => {
        await withHome(async root => {
            await mkdir(join(root, '.roo', 'rules-ask'), { recursive: true })
            await mkdir(join(root, '.agent', 'rules-build'), { recursive: true })
            await writeFile(join(root, '.roo', 'rules-ask', 'a.md'), '询问规则')
            await writeFile(join(root, '.agent', 'rules-build', 'b.md'), '构建规则')

            const ask = await Rules.read({ workspace: root, stopAt: root, mode: 'ask' })
            expect(ask).toContain('询问规则')
            expect(ask).not.toContain('构建规则')

            const build = await Rules.read({ workspace: root, stopAt: root, mode: 'build' })
            expect(build).toContain('构建规则')
            expect(build).not.toContain('询问规则')
        })
    })

    test('模式名不合法时不会拼出工作区外的路径', async () => {
        await withHome(async root => {
            await mkdir(join(root, '.roo', 'rules-ask'), { recursive: true })
            await writeFile(join(root, '.roo', 'rules-ask', 'a.md'), '不该被读到')

            // ../evil 不是合法模式名，只读通用目录，通用目录是空的。
            expect(await Rules.read({ workspace: root, stopAt: root, mode: '../evil' })).toBe('')
        })
    })

    test('关掉规则读取后系统提示词保持用户原样', async () => {
        await withHome(async root => {
            await writeFile(join(root, 'AGENTS.md'), '不该出现')
            await Config.set({
                providers: [{ name: 'local', models: ['model'] }],
                prompt: { system: '用户提示' },
                rules: { enabled: false },
            })
            await Rules.load({ workspace: root, stopAt: root })

            expect(Config.resolve({ provider: 'local', model: 'model' }).system).toBe('用户提示')
        })
    })

    test('打开规则读取后拼在用户提示词后面', async () => {
        await withHome(async root => {
            await writeFile(join(root, 'AGENTS.md'), '规则内容')
            await Config.set({
                providers: [{ name: 'local', models: ['model'] }],
                prompt: { system: '用户提示' },
                rules: { enabled: true },
            })
            await Rules.load({ workspace: root, stopAt: root })

            const system = Config.resolve({ provider: 'local', model: 'model' }).system
            expect(system.startsWith('用户提示')).toBe(true)
            expect(system).toContain('规则内容')
        })
    })

    test('规则太长时截断，不会整份丢掉', async () => {
        await withHome(async root => {
            await writeFile(join(root, 'AGENTS.md'), 'a'.repeat(40000))
            const text = await Rules.read({ workspace: root, stopAt: root })
            expect(text).toContain('已截断')
            expect(Buffer.byteLength(text)).toBeLessThan(34 * 1024)
        })
    })

    test('apply 没有规则时原样返回', () => {
        expect(Rules.apply({ system: 'x' })).toBe('x')
        expect(Rules.apply({ system: 'x', rules: 'y' })).toBe('x\n\ny')
        expect(Rules.apply({ system: '', rules: 'y' })).toBe('y')
    })
})
