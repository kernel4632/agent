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

import Config from '../config/config.js'
import Tools from '../tool-registry/catalog.js'
import Store from '../agent/state.js'
import { toolFiles } from '../tool-registry/files.js'
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
            await Config.set({ permission: { '*': 'ask', read_file: 'deny' } })
            await mkdir(join(root, 'tools'), { recursive: true })
            await writeFile(join(root, 'tools', 'mine.js'), [
                "export default {",
                "    name: 'my_tool',",
                "    description: 'test tool',",
                "    ui: { view: 'custom', title: '我的工具' },",
                "    inputSchema: { type: 'object', properties: {} },",
                "    async execute() { return 'ok' },",
                "}",
            ].join('\n'))

            const tools = await Tools.list()
            const byName = Object.fromEntries(tools.map(item => [item.name, item]))
            expect(byName.read_file.permission).toBe('deny')
            expect(byName.read_file.ui?.view).toBe('file-read')
            expect(byName.execute_command.permission).toBe('ask')
            expect(byName.execute_command.ui?.view).toBe('command')
            expect(byName.my_tool.permission).toBe('ask')
            expect(byName.my_tool.kind).toBe('other')
            expect(byName.my_tool.ui?.view).toBe('custom')
            expect(byName.new_task).toBeDefined()
            expect(byName.new_task.ui?.view).toBe('subtask')
            expect(byName.update_todo_list.configurable).toBe(false)
            expect(byName.update_todo_list.ui?.view).toBe('todo')
            expect(byName.attempt_completion.ui?.view).toBe('completion')
            // 旧会话里的 finish 还能找回 attempt_completion，前端不再单独存别名表。
            expect(byName.attempt_completion.previousNames).toContain('finish')
        })
    })

    test('用户工具自己声明的类别和文件参数会被登记', async () => {
        await withHome(async root => {
            await mkdir(join(root, 'tools'), { recursive: true })
            await writeFile(join(root, 'tools', 'declared.js'), [
                "export default {",
                "    name: 'declared_tool',",
                "    kind: 'read',",
                "    files: input => [input.path],",
                "    description: 'test tool',",
                "    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },",
                "    async execute() { return 'ok' },",
                "}",
            ].join('\n'))

            const tools = await Tools.list()
            expect(tools.find(tool => tool.name === 'declared_tool')?.kind).toBe('read')
            expect(toolFiles({ toolName: 'declared_tool', input: { path: 'a.txt' } })).toEqual(['a.txt'])
        })
    })

    test('删掉用户工具文件后，下一次扫描不会再返回它', async () => {
        await withHome(async root => {
            await mkdir(join(root, 'tools'), { recursive: true })
            const file = join(root, 'tools', 'temporary.js')
            await writeFile(file, [
                "export default {",
                "    name: 'temporary_tool',",
                "    kind: 'read',",
                "    files: input => [input.path],",
                "    description: 'temporary',",
                "    inputSchema: { type: 'object', properties: {} },",
                "    async execute() { return 'ok' },",
                "}",
            ].join('\n'))

            expect((await Tools.list()).some(tool => tool.name === 'temporary_tool')).toBe(true)
            await rm(file, { force: true })
            // 不重启进程也要消失；工具目录是当前位置的唯一真相。
            expect((await Tools.list()).some(tool => tool.name === 'temporary_tool')).toBe(false)
            expect(toolFiles({ toolName: 'temporary_tool', input: { path: 'a.txt' } })).toEqual([])
        })
    })

    test('全局 deny 在工具目录里也显示成拒绝', async () => {
        await withHome(async () => {
            // 设置页显示的动作必须和真正执行时一致；全局 deny 以前会被显示成 ask。
            await Config.set({ permission: { '*': 'deny' } })
            const tools = await Tools.list()
            const byName = Object.fromEntries(tools.map(item => [item.name, item]))
            expect(byName.execute_command.permission).toBe('deny')
            expect(byName.read_file.permission).toBe('deny')
        })
    })

    test('HTTP 接口返回工具数组', async () => {
        await withHome(async () => {
            const response = await app.handle(new Request('http://localhost/tool/list'))
            expect(response.status).toBe(200)
            const tools = await response.json()
            expect(Array.isArray(tools)).toBe(true)
            expect(tools.some(item => item.name === 'read_file')).toBe(true)
        })
    })
})
