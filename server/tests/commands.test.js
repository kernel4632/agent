/*
 * 斜杠命令测试：三个目录的扫描、同名覆盖、说明兜底和接口。
 *
 * 命令只影响输入框里展开的文字，不碰会话状态；所以这里只看扫描结果。
 * 每个测试用自己的临时数据目录和工作区。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Commands from '../workspace/commands.js'
import { app } from '../server.js'

const withHome = async callback => {
    const root = join(tmpdir(), `agent-commands-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    await mkdir(root, { recursive: true })
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

const withWorkspace = async callback => {
    const root = join(tmpdir(), `agent-commands-ws-${crypto.randomUUID()}`)
    await mkdir(root, { recursive: true })
    try {
        return await callback(root)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}

// 写一条带 frontmatter 的命令。
const writeCommand = async (dir, file, name, description, prompt) => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, file), `---\nname: ${name}\ndescription: ${description}\n---\n${prompt}`)
}

describe('斜杠命令', () => {
    test('全局命令和项目命令都能读到，项目覆盖全局', async () => {
        await withHome(async home => {
            await withWorkspace(async workspace => {
                await writeCommand(join(home, 'commands'), 'review.md', 'review', '全局审查', '全局审查正文')
                await writeCommand(join(workspace, '.roo', 'commands'), 'review.md', 'review', 'roo 审查', 'roo 审查正文')
                await writeCommand(join(workspace, '.agent', 'commands'), 'review.md', 'review', '项目审查', '项目审查正文')
                await writeCommand(join(home, 'commands'), 'deploy.md', 'deploy', '部署', '部署正文')

                const commands = await Commands.list({ workspace })
                const review = commands.find(item => item.name === 'review')
                expect(review.description).toBe('项目审查')
                expect(review.prompt).toBe('项目审查正文')
                expect(commands.map(item => item.name)).toEqual(['deploy', 'review'])
            })
        })
    })

    test('没写 name 时用文件名，没写说明时用正文第一行', async () => {
        await withHome(async home => {
            await withWorkspace(async workspace => {
                await mkdir(join(home, 'commands'), { recursive: true })
                await writeFile(join(home, 'commands', 'no-name.md'), '第一行说明\n第二行正文')

                const commands = await Commands.list({ workspace })
                expect(commands).toEqual([{ name: 'no-name', description: '第一行说明', prompt: '第一行说明\n第二行正文' }])
            })
        })
    })

    test('名字不合法或正文为空时跳过', async () => {
        await withHome(async home => {
            await withWorkspace(async workspace => {
                await mkdir(join(home, 'commands'), { recursive: true })
                await writeFile(join(home, 'commands', 'bad.md'), '---\nname: bad name\n---\n正文')
                await writeFile(join(home, 'commands', 'empty.md'), '---\nname: empty\n---\n   ')

                expect(await Commands.list({ workspace })).toEqual([])
            })
        })
    })

    test('HTTP 接口返回命令数组', async () => {
        await withHome(async () => {
            const response = await app.handle(new Request('http://localhost/command/list'))
            expect(response.status).toBe(200)
            expect(Array.isArray(await response.json())).toBe(true)
        })
    })
})
