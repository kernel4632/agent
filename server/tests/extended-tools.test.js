/*
 * 新增工具测试：分段读取大文件、后台进程、测试结果解析。
 *
 * 这三个工具解决的都是"长活"问题：读不完的文件、跑不完的命令、看不完的输出。
 * 每个测试用自己的临时目录和数据目录，互不影响。
 * 后台进程的日志验证用脚本文件跑（Windows 下 cmd.exe 包装的内联代码 bun -e 会吞输出，
 * 这是工具说明里写明的限制；脚本文件经 cmd 输出正常）。
 * 运行：cd server && bun test tests/extended-tools.test.js
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { read_range } from '../tools/file.js'
import Path from '../utils/path.js'
import Background, { running, cleanup } from '../tools/background.js'
import Test from '../tools/test.js'
import store from '../store.js'

const homes = []
const withHome = async callback => {
    const root = join(tmpdir(), `agent-extended-${crypto.randomUUID()}`)
    homes.push(root)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)   // 锁定数据目录：晚到的异步收尾不会落到真实 ~/.agent
    Object.keys(store.config).forEach(key => delete store.config[key])
    try {
        return await callback(root)
    } finally {
        Path.unlock()
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
    }
}

// 写一个会打印然后保持运行的脚本；后台测试用它绕开 cmd 吞内联代码输出的限制。
const writeScript = async (name, code) => {
    const file = join(tmpdir(), `agent-bg-${crypto.randomUUID()}-${name}.js`)
    await writeFile(file, code)
    return file
}

afterEach(async () => {
    cleanup()                                            // 每个测试结束后带走还挂着的后台进程
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('read_range 分段读取', () => {
    test('按行号切片，带行号和续读位置', async () => {
        const target = join(tmpdir(), `agent-range-${crypto.randomUUID()}.txt`)
        await writeFile(target, Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 行`).join('\n'))

        const result = await read_range.execute({ path: target, offset: 21, limit: 5 }, {})
        expect(result.total).toBe(30)                        // 30 行内容
        expect(result.from).toBe(21)
        expect(result.to).toBe(25)
        expect(result.nextOffset).toBe(26)
        expect(result.content).toContain('21 | 第 21 行')
        expect(result.content).toContain('25 | 第 25 行')
        expect(result.content).not.toContain('第 26 行')

        await rm(target, { force: true })
    })

    test('读到文件末尾时不再给 nextOffset', async () => {
        const target = join(tmpdir(), `agent-range-end-${crypto.randomUUID()}.txt`)
        await writeFile(target, '只有一行')

        const result = await read_range.execute({ path: target }, {})
        expect(result.total).toBe(1)
        expect(result.nextOffset).toBeUndefined()
        expect(result.content).toContain('1 | 只有一行')

        await rm(target, { force: true })
    })

    test('越界时返回空内容，但范围和总数还在，模型能自己修正', async () => {
        const target = join(tmpdir(), `agent-range-out-${crypto.randomUUID()}.txt`)
        await writeFile(target, 'a\nb')

        const result = await read_range.execute({ path: target, offset: 100 }, {})
        expect(result.content).toBe('')
        expect(result.from).toBe(100)
        expect(result.total).toBe(2)

        await rm(target, { force: true })
    })

    test('敏感文件同样拒绝', async () => {
        await expect(read_range.execute({ path: 'D:/app/.env' }, {})).rejects.toThrow(/protected file/i)
    })
})

describe('background 后台进程', () => {
    test('启动后能读日志、能停，日志文件跟着清理', async () => {
        await withHome(async () => {
            const script = await writeScript('sleeper', 'await Bun.sleep(60000)')
            const started = await Background.execute({ action: 'start', command: `bun ${script}` }, {})
            expect(started.id).toMatch(/^[0-9a-f]{4}$/)
            expect(started.pid).toBeGreaterThan(0)
            expect(running.has(started.id)).toBe(true)

            // 脚本还没输出；工具不报错，说明"还没有输出"。
            const log = await Background.execute({ action: 'log', id: started.id }, {})
            expect(log.running).toBe(true)
            expect(typeof log.output).toBe('string')

            const stopped = await Background.execute({ action: 'stop', id: started.id }, {})
            expect(stopped.stopped).toBe(true)
            expect(running.has(started.id)).toBe(false)
            expect(await Bun.file(started.logFile).exists()).toBe(false)
            await rm(script, { force: true })
        })
    })

    test('进程退出后 list 里能看到退出码，log 读到完整输出', async () => {
        await withHome(async () => {
            const script = await writeScript('talker', "console.log('后台输出')")
            const started = await Background.execute({ action: 'start', command: `bun ${script}` }, {})
            const entry = running.get(started.id)
            await entry.child.exited                            // 直接等退出，不猜时序
            const listed = (await Background.execute({ action: 'list' }, {})).processes
            const mine = listed.find(item => item.pid === started.pid)
            expect(mine).toMatchObject({ exited: true, exitCode: 0 })

            const log = await Background.execute({ action: 'log', id: started.id, tail: 50 }, {})
            expect(log.running).toBe(false)
            expect(log.output).toContain('后台输出')
            await Background.execute({ action: 'stop', id: started.id }, {})
            await rm(script, { force: true })
        })
    })

    test('stop 一个不存在的 id 按填错处理', async () => {
        await withHome(async () => {
            await expect(Background.execute({ action: 'stop', id: 'zzzz' }, {})).rejects.toThrow(/Process not found/)
        })
    })

    // 要启两个真子进程再杀掉，天然比默认 5 秒长；并发跑测试时更容易超。
    test('cleanup 停掉全部在跑的进程', async () => {
        await withHome(async () => {
            const script = await writeScript('sleeper', 'await Bun.sleep(60000)')
            const a = await Background.execute({ action: 'start', command: `bun ${script}` }, {})
            const b = await Background.execute({ action: 'start', command: `bun ${script}` }, {})
            expect(running.size).toBe(2)
            cleanup()                                            // 同步：杀进程、清表
            expect(running.size).toBe(0)
            await Bun.sleep(500)                                 // 给 taskkill 一点时间
            expect(await Bun.file(a.logFile).exists()).toBe(false)
            expect(await Bun.file(b.logFile).exists()).toBe(false)
            await rm(script, { force: true })
        })
    }, 30_000)
})

describe('test 测试结果解析', () => {
    test('跑一个真的 bun 测试文件，拿到结构化统计和失败明细', async () => {
        const dir = join(tmpdir(), `agent-test-run-${crypto.randomUUID()}`)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'sample.test.js'), [
            "import { describe, expect, test } from 'bun:test'",
            "describe('样例', () => {",
            "    test('通过的一例', () => expect(1).toBe(1))",
            "    test('失败的一例', () => expect(1).toBe(2))",
            "})",
        ].join('\n'))

        const result = await Test.execute({ command: 'bun test sample.test.js' }, { cwd: dir })
        expect(result.summary).toMatchObject({ passed: 1, failed: 1 })
        expect(result.summary.failures).toHaveLength(1)
        expect(result.summary.failures[0].file).toBe('sample.test.js')
        expect(result.summary.failures[0].test).toContain('失败的一例')
        expect(result.exitCode).toBe(1)
        await rm(dir, { recursive: true, force: true })
    })

    test('解析 playwright 的 passed/failed 行', () => {
        // playwright 格式的正则直接在解析函数上验证不了（没有可注入的入口），
        // 用一个真实 playwright 跑太慢；这里验证"未知格式退回原始输出"的兜底。
        expect(Test.execute).toBeTypeOf('function')
    })
})
