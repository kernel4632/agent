/*
 * 工具接口测试：工具按类别分文件后，真正执行一次确认参数没有接错。
 *
 * 这里只测工具本身，不启动 HTTP 服务；权限、快照和智能体由别的测试覆盖。
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { read_file, write_to_file, list_files, search_files, edit, apply_patch } from '../tools/file.js'
import shell from '../tools/shell.js'
import todo from '../tools/todo.js'

const root = await mkdtemp(join(tmpdir(), 'agent-tool-api-'))

afterAll(async () => {
    await rm(root, { recursive: true, force: true })
})

describe('工具接口', () => {
    test('暴露工具名和参数', () => {
        expect(read_file.name).toBe('read_file')
        expect(write_to_file.name).toBe('write_to_file')
        expect(list_files.name).toBe('list_files')
        expect(search_files.name).toBe('search_files')
        expect(shell.name).toBe('execute_command')
        expect(edit.name).toBe('edit')
        expect(apply_patch.name).toBe('apply_patch')
        expect(todo.name).toBe('update_todo_list')

        expect(Object.keys(read_file.inputSchema.properties)).toEqual(['path'])
        expect(Object.keys(write_to_file.inputSchema.properties)).toEqual(['path', 'content'])
        expect(Object.keys(list_files.inputSchema.properties)).toEqual(['path', 'recursive'])
        expect(Object.keys(search_files.inputSchema.properties)).toEqual(['path', 'regex', 'file_pattern', 'context'])
        expect(Object.keys(shell.inputSchema.properties)).toEqual(['command', 'cwd'])
        expect(Object.keys(edit.inputSchema.properties)).toEqual(['file_path', 'old_string', 'new_string', 'replace_all'])
        expect(Object.keys(todo.inputSchema.properties)).toEqual(['todos'])
    })

    test('read_file、write_to_file、list_files 能读写和递归列目录', async () => {
        const target = join(root, 'nested', 'a.txt')
        await write_to_file.execute({ path: target, content: 'hello' })
        expect(await read_file.execute({ path: target })).toBe('hello')

        await mkdir(join(root, 'nested', 'child'), { recursive: true })
        await writeFile(join(root, 'nested', 'child', 'b.txt'), 'b')
        const entries = await list_files.execute({ path: root, recursive: true })
        expect(entries).toContain('nested/a.txt')
        expect(entries).toContain('nested/child/')
        expect(entries).toContain('nested/child/b.txt')
    })

    test('相对路径按会话当前目录算', async () => {
        await write_to_file.execute({ path: 'relative.txt', content: 'ok' }, { cwd: root })
        expect(await read_file.execute({ path: 'relative.txt' }, { cwd: root })).toBe('ok')
    })

    test('edit 使用 file_path、old_string、new_string，并支持 replace_all', async () => {
        const target = join(root, 'edit.txt')
        await writeFile(target, 'old\nold\n')

        await expect(edit.execute({ file_path: target, old_string: 'old', new_string: 'new' }))
            .rejects.toThrow('exactly once')
        await edit.execute({ file_path: target, old_string: 'old', new_string: 'new', replace_all: true })
        expect(await readFile(target, 'utf8')).toBe('new\nnew\n')
    })

    test('apply_patch 一次改多个文件，任一失败就整体不改', async () => {
        const first = join(root, 'patch-a.txt')
        const second = join(root, 'patch-b.txt')
        await writeFile(first, 'a0')
        await writeFile(second, 'b0')

        await apply_patch.execute({ patches: [
            { path: first, oldText: 'a0', newText: 'a1' },
            { path: second, oldText: 'b0', newText: 'b1' },
        ] })
        expect(await readFile(first, 'utf8')).toBe('a1')
        expect(await readFile(second, 'utf8')).toBe('b1')

        await expect(apply_patch.execute({ patches: [
            { path: first, oldText: 'a1', newText: 'a2' },
            { path: second, oldText: 'missing', newText: 'b2' },
        ] })).rejects.toThrow('exactly once')
        expect(await readFile(first, 'utf8')).toBe('a1')
    })

    test('search_files 使用 regex 和 file_pattern', async () => {
        await writeFile(join(root, 'search.js'), 'const needle = 1\n')
        await writeFile(join(root, 'search.txt'), 'needle\n')
        const result = await search_files.execute({ path: root, regex: 'needle', file_pattern: '*.js' }, {})
        expect(result).toContain('search.js')
        expect(result).not.toContain('search.txt')
    })

    test('search_files 的 context 返回命中前后几行', async () => {
        await writeFile(join(root, 'context.js'), 'before\nneedle\nafter\n')
        const result = await search_files.execute({ path: root, regex: 'needle', file_pattern: 'context.js', context: 1 }, {})
        expect(result).toContain('before')
        expect(result).toContain('needle')
        expect(result).toContain('after')
    })

    test('execute_command 使用 cwd，并且按会话目录算相对路径', async () => {
        const result = await shell.execute({ command: 'echo hello', cwd: 'nested' }, { cwd: root })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('hello')
    })

    test('只传 input 时搜索和命令也能执行', async () => {
        await writeFile(join(root, 'bare.js'), 'const needle = 1\n')
        expect(await search_files.execute({ path: root, regex: 'needle', file_pattern: 'bare.js' }))
            .toContain('bare.js')
        const result = await shell.execute({ command: 'echo bare', cwd: root })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('bare')
    })

    test('update_todo_list 解析 Markdown 清单', async () => {
        const result = await todo.execute({ todos: '- [x] done\n- [-] doing\n- [ ] later' })
        expect(result.items).toEqual([
            { text: 'done', status: 'completed' },
            { text: 'doing', status: 'in_progress' },
            { text: 'later', status: 'pending' },
        ])
    })
})
