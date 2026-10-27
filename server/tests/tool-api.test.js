/*
 * 工具接口测试：工具名和参数对齐 Roo Code 后，真正执行一次确认参数没有接错。
 *
 * 这里只测工具本身，不启动 HTTP 服务；权限、快照和模式由别的测试覆盖。
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fileTools from '../tools/file.js'
import searchFiles from '../tools/grep.js'
import executeCommand from '../tools/shell.js'
import edit from '../tools/edit.js'
import updateTodoList from '../tools/todo.js'

const root = await mkdtemp(join(tmpdir(), 'agent-tool-api-'))
const byName = list => Object.fromEntries(list.map(tool => [tool.name, tool]))
const files = byName(fileTools)

afterAll(async () => {
    await rm(root, { recursive: true, force: true })
})

describe('Roo Code 工具接口', () => {
    test('暴露新的工具名和参数', () => {
        expect(files.read_file).toBeDefined()
        expect(files.write_to_file).toBeDefined()
        expect(files.list_files).toBeDefined()
        expect(searchFiles.name).toBe('search_files')
        expect(executeCommand.name).toBe('execute_command')
        expect(edit.name).toBe('edit')
        expect(updateTodoList.name).toBe('update_todo_list')

        expect(Object.keys(files.read_file.inputSchema.properties)).toEqual(['path'])
        expect(Object.keys(files.write_to_file.inputSchema.properties)).toEqual(['path', 'content'])
        expect(Object.keys(files.list_files.inputSchema.properties)).toEqual(['path', 'recursive'])
        expect(Object.keys(searchFiles.inputSchema.properties)).toEqual(['path', 'regex', 'file_pattern'])
        expect(Object.keys(executeCommand.inputSchema.properties)).toEqual(['command', 'cwd'])
        expect(Object.keys(edit.inputSchema.properties)).toEqual(['file_path', 'old_string', 'new_string', 'replace_all'])
        expect(Object.keys(updateTodoList.inputSchema.properties)).toEqual(['todos'])
    })

    test('read_file、write_to_file、list_files 能读写和递归列目录', async () => {
        const target = join(root, 'nested', 'a.txt')
        await files.write_to_file.execute({ path: target, content: 'hello' })
        expect(await files.read_file.execute({ path: target })).toBe('hello')

        await mkdir(join(root, 'nested', 'child'), { recursive: true })
        await writeFile(join(root, 'nested', 'child', 'b.txt'), 'b')
        const entries = await files.list_files.execute({ path: root, recursive: true })
        expect(entries).toContain('nested/a.txt')
        expect(entries).toContain('nested/child/')
        expect(entries).toContain('nested/child/b.txt')
    })

    test('edit 使用 file_path、old_string、new_string，并支持 replace_all', async () => {
        const target = join(root, 'edit.txt')
        await writeFile(target, 'old\nold\n')

        await expect(edit.execute({ file_path: target, old_string: 'old', new_string: 'new' }))
            .rejects.toThrow('exactly once')
        await edit.execute({ file_path: target, old_string: 'old', new_string: 'new', replace_all: true })
        expect(await readFile(target, 'utf8')).toBe('new\nnew\n')
    })

    test('search_files 使用 regex 和 file_pattern', async () => {
        await writeFile(join(root, 'search.js'), 'const needle = 1\n')
        await writeFile(join(root, 'search.txt'), 'needle\n')
        const result = await searchFiles.execute({ path: root, regex: 'needle', file_pattern: '*.js' }, {})
        expect(result).toContain('search.js')
        expect(result).not.toContain('search.txt')
    })

    test('execute_command 使用 cwd', async () => {
        const result = await executeCommand.execute({ command: 'echo hello', cwd: root }, {})
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('hello')
    })

    test('只传 input 时搜索和命令也能执行', async () => {
        // agent-core 的契约是 execute(input, options?)；文件工具在子进程里只收到 input。
        // 之前把第二参写成必解构，每次真实执行都会崩。
        await writeFile(join(root, 'bare.js'), 'const needle = 1\n')
        expect(await searchFiles.execute({ path: root, regex: 'needle', file_pattern: 'bare.js' }))
            .toContain('bare.js')
        const result = await executeCommand.execute({ command: 'echo bare', cwd: root })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('bare')
    })

    test('update_todo_list 解析 Roo 的 Markdown 清单', async () => {
        const result = await updateTodoList.execute({ todos: '- [x] done\n- [-] doing\n- [ ] later' })
        expect(result.items).toEqual([
            { text: 'done', status: 'completed' },
            { text: 'doing', status: 'in_progress' },
            { text: 'later', status: 'pending' },
        ])
    })
})
