/*
 * 写后诊断测试：配置了 diagnostics.command 时，写入结果后面要带上命令输出。
 *
 * 诊断只是顺手的好事：没配置、命令失败、输出为空都不该影响写入本身。
 * 每个测试用自己的临时数据目录。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Diagnose from '../utils/diagnose.js'
import fileTools from '../tools/file.js'
import editTool from '../tools/edit.js'

const withHome = async callback => {
    const root = join(tmpdir(), `agent-diagnostics-${crypto.randomUUID()}`)
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

// 让测试在 Windows 和别的平台上都能跑。
const echo = text => process.platform === 'win32' ? `cmd /c echo ${text}` : `sh -c "echo ${text}"`
const fail = text => process.platform === 'win32' ? `cmd /c echo ${text} & exit /b 1` : `sh -c "echo ${text}; exit 1"`

const writeConfig = (root, diagnostics) => writeFile(join(root, 'config.json'), JSON.stringify({ diagnostics }))

describe('写后诊断', () => {
    test('没有配置 command 时完全不做任何事', async () => {
        await withHome(async () => {
            expect(await Diagnose.afterWrite()).toBe('')
        })
    })

    test('配置后把命令输出附在结果后面', async () => {
        await withHome(async root => {
            await writeConfig(root, { command: echo('ERR') })
            const text = await Diagnose.afterWrite()
            expect(text).toContain('[diagnostics exit 0]')
            expect(text).toContain('ERR')
        })
    })

    test('命令失败时带上退出码和输出，但不抛错', async () => {
        await withHome(async root => {
            await writeConfig(root, { command: fail('FAIL') })
            const text = await Diagnose.afterWrite()
            expect(text).toContain('[diagnostics exit 1]')
            expect(text).toContain('FAIL')
        })
    })

    test('命令本身不存在也只返回一条说明，不影响写入', async () => {
        await withHome(async root => {
            await writeConfig(root, { command: 'definitely-not-a-command-xyz' })
            const text = await Diagnose.afterWrite()
            expect(text).toContain('[diagnostics')
        })
    })

    test('write_to_file 的返回值里带上诊断输出', async () => {
        await withHome(async root => {
            await writeConfig(root, { command: echo('DIAG-OK') })
            const write = fileTools.find(tool => tool.name === 'write_to_file')
            const target = join(root, 'written.txt')
            const result = await write.execute({ path: target, content: 'hello' })
            expect(result).toContain('Wrote')
            expect(result).toContain('DIAG-OK')
            expect(await Bun.file(target).text()).toBe('hello')
        })
    })

    test('edit 的返回值里也带上诊断输出', async () => {
        await withHome(async root => {
            await writeConfig(root, { command: echo('EDIT-DIAG') })
            const target = join(root, 'edited.txt')
            await writeFile(target, 'old text')
            const result = await editTool.execute({ file_path: target, old_string: 'old', new_string: 'new' })
            expect(result).toContain('Edited')
            expect(result).toContain('EDIT-DIAG')
            expect(await Bun.file(target).text()).toBe('new text')
        })
    })
})
