/*
 * 工具目录测试：内置工具、用户工具和当前权限动作。
 *
 * 设置页靠这份目录画开关，所以名字必须齐，权限必须和配置一致。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Config from '../commands/config.js'
import Tools from '../commands/tools.js'
import Store from '../store.js'
import { app } from '../server.js'

const withHome = async callback => {
    const root = join(tmpdir(), `agent-tools-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    await mkdir(root, { recursive: true })
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

describe('工具目录', () => {
    test('内置工具和用户工具都在，权限跟着配置走', async () => {
        await withHome(async root => {
            await Config.set({ permission: { '*': 'ask', file_read: 'deny' } })
            await mkdir(join(root, 'tools'), { recursive: true })
            await writeFile(join(root, 'tools', 'mine.js'), [
                "export default {",
                "    name: 'my_tool',",
                "    description: 'test tool',",
                "    inputSchema: { type: 'object', properties: {} },",
                "    async execute() { return 'ok' },",
                "}",
            ].join('\n'))

            const tools = await Tools.list()
            const byName = Object.fromEntries(tools.map(item => [item.name, item]))
            expect(byName.file_read.permission).toBe('deny')
            expect(byName.shell.permission).toBe('ask')
            expect(byName.my_tool.permission).toBe('ask')
            expect(byName.my_tool.kind).toBe('other')
            expect(byName.task).toBeDefined()
        })
    })

    test('HTTP 接口返回工具数组', async () => {
        await withHome(async () => {
            const response = await app.handle(new Request('http://localhost/tool/list'))
            expect(response.status).toBe(200)
            const tools = await response.json()
            expect(Array.isArray(tools)).toBe(true)
            expect(tools.some(item => item.name === 'file_read')).toBe(true)
        })
    })
})
