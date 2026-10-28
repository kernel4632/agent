/*
 * 工作区边界测试：工作区外的路径必须被 external_directory 规则明确允许。
 *
 * 这里盯的是"默认安全"：工具规则写着 allow 时，也不能顺手读到工作区外面。
 * 每个测试用自己的临时数据目录和工作区，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Boundary from '../safety/boundary.js'
import Store from '../agent/state.js'
import History from '../conversation/history.js' // 会话历史的内存缓存由 history.js 自己管。
import ToolCatalog from '../tool-registry/catalog.js' // 直接测边界时也要先登记工具的文件参数。

// 每个测试使用独立数据目录，并把内存里的配置清空。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-boundary-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    await mkdir(root, { recursive: true })
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.agents.clear()
    History.clear()
    Store.snapshots.clear()
    Store.approvals.clear()
    Store.settings.clear()
    Store.recentCalls.clear()
    try {
        await ToolCatalog.register()
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

// 造一个工作区和一个工作区外的目录。
const withWorkspace = async callback => {
    const base = join(tmpdir(), `agent-workspace-${crypto.randomUUID()}`)
    const workspace = join(base, 'workspace')
    const outside = join(base, 'outside')
    await mkdir(workspace, { recursive: true })
    await mkdir(outside, { recursive: true })
    const insideFile = join(workspace, 'inside.txt')
    const outsideFile = join(outside, 'outside.txt')
    await writeFile(insideFile, 'inside')
    await writeFile(outsideFile, 'outside')
    try {
        return await callback({ base, workspace, outside, insideFile, outsideFile })
    } finally {
        await rm(base, { recursive: true, force: true })
    }
}

describe('工作区边界', () => {
    test('工作区里的文件直接放行', async () => {
        await withHome(async () => {
            await withWorkspace(async ({ workspace, insideFile }) => {
                const result = await Boundary.check({ workspace, toolName: 'read_file', input: { path: insideFile } })
                expect(result.effect).toBe('allow')
                expect(result.paths).toEqual([])
            })
        })
    })

    test('不配置 external_directory 时保持原来的行为', async () => {
        await withHome(async () => {
            await withWorkspace(async ({ workspace, outsideFile }) => {
                Store.config.permission = { '*': 'allow' }
                const result = await Boundary.check({ workspace, toolName: 'read_file', input: { path: outsideFile } })
                expect(result.effect).toBe('allow')
            })
        })
    })

    test('配置后工作区外的文件要问，不会因为工具规则是 allow 就放行', async () => {
        await withHome(async () => {
            await withWorkspace(async ({ workspace, outsideFile }) => {
                Store.config.permission = { '*': 'allow', external_directory: { '*': 'ask' } }
                const result = await Boundary.check({ workspace, toolName: 'read_file', input: { path: outsideFile } })
                expect(result.effect).toBe('ask')
                expect(result.paths).toEqual([outsideFile])
            })
        })
    })

    test('external_directory 可以放行指定目录', async () => {
        await withHome(async () => {
            await withWorkspace(async ({ workspace, outside, outsideFile }) => {
                Store.config.permission = {
                    '*': 'allow',
                    external_directory: { [`${outside.replace(/\\/g, '/')}/**`]: 'allow' },
                }
                const result = await Boundary.check({ workspace, toolName: 'read_file', input: { path: outsideFile } })
                expect(result.effect).toBe('allow')
            })
        })
    })

    test('external_directory 的 deny 优先', async () => {
        await withHome(async () => {
            await withWorkspace(async ({ workspace, outsideFile }) => {
                Store.config.permission = { external_directory: { '*': 'deny' } }
                const result = await Boundary.check({ workspace, toolName: 'read_file', input: { path: outsideFile } })
                expect(result.effect).toBe('deny')
            })
        })
    })

    test('用 .. 绕出工作区也会被看出来', async () => {
        await withHome(async () => {
            await withWorkspace(async ({ workspace, outsideFile }) => {
                Store.config.permission = { external_directory: { '*': 'ask' } }
                const previous = process.cwd()
                process.chdir(workspace)
                try {
                    // 用相对路径从工作区出发绕到外面。
                    const relative = `../outside/${outsideFile.split(/[\\/]/).pop()}`
                    const result = await Boundary.check({ workspace, toolName: 'read_file', input: { path: relative } })
                    expect(result.effect).toBe('ask')
                } finally {
                    process.chdir(previous)
                }
            })
        })
    })

    test('shell 的目录参数也在检查范围内', async () => {
        await withHome(async () => {
            await withWorkspace(async ({ workspace, outside }) => {
                Store.config.permission = { '*': 'allow', external_directory: { '*': 'ask' } }
                const result = await Boundary.check({ workspace, toolName: 'execute_command', input: { command: 'ls', directory: outside } })
                expect(result.effect).toBe('ask')
            })
        })
    })

    test('符号链接指向工作区外时，按真实路径判断', async () => {
        await withHome(async () => {
            await withWorkspace(async ({ workspace, outside, outsideFile }) => {
                Store.config.permission = { '*': 'allow', external_directory: { '*': 'ask' } }
                const link = join(workspace, 'escape')
                try {
                    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
                } catch {
                    return // 当前环境不允许建链接时跳过，不把环境问题算成失败。
                }
                const result = await Boundary.check({ workspace, toolName: 'read_file', input: { path: join(link, outsideFile.split(/[\\/]/).pop()) } })
                expect(result.effect).toBe('ask')
            })
        })
    })
})

