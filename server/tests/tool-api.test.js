/*
 * 工具接口测试：工具按类别分文件后，真正执行一次确认参数没有接错。
 *
 * 这里只测工具本身，不启动 HTTP 服务；权限、快照和智能体由别的测试覆盖。
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { read_file, write_file, find_files, search_text, edit } from '../tools/file.js'
import shell from '../tools/shell.js'
import todo from '../tools/todo.js'

const root = await mkdtemp(join(tmpdir(), 'agent-tool-api-'))

afterAll(async () => {
    await rm(root, { recursive: true, force: true })
})

describe('工具接口', () => {
    test('暴露工具名和参数', () => {
        expect(read_file.name).toBe('read_file')
        expect(write_file.name).toBe('write_file')
        expect(find_files.name).toBe('find_files')
        expect(search_text.name).toBe('search_text')
        expect(edit.name).toBe('edit')
        expect(shell.name).toBe('execute_command')
        expect(todo.name).toBe('update_todo_list')

        expect(Object.keys(read_file.inputSchema.properties)).toEqual(['path'])
        expect(Object.keys(write_file.inputSchema.properties)).toEqual(['path', 'content'])
        expect(Object.keys(find_files.inputSchema.properties)).toEqual(['path', 'pattern', 'recursive'])
        expect(Object.keys(search_text.inputSchema.properties)).toEqual(['path', 'regex', 'filePattern', 'context'])
        expect(Object.keys(shell.inputSchema.properties)).toEqual(['command', 'cwd'])
        expect(Object.keys(edit.inputSchema.properties)).toEqual(['path', 'edits'])
        expect(Object.keys(edit.inputSchema.properties.edits.items.properties)).toEqual(['oldText', 'newText', 'replaceAll'])
        expect(Object.keys(todo.inputSchema.properties)).toEqual(['todos'])
    })

    test('read_file、write_file、find_files 能读写、列目录和按名字找文件', async () => {
        const target = join(root, 'nested', 'a.txt')
        await write_file.execute({ path: target, content: 'hello' })
        expect(await read_file.execute({ path: target })).toBe('hello')

        await mkdir(join(root, 'nested', 'child'), { recursive: true })
        await writeFile(join(root, 'nested', 'child', 'b.txt'), 'b')
        const entries = await find_files.execute({ path: root, recursive: true })
        expect(entries).toContain('nested/a.txt')
        expect(entries).toContain('nested/child/')
        expect(entries).toContain('nested/child/b.txt')

        const found = await find_files.execute({ path: root, pattern: '**/*.txt' })
        expect(found).toContain('nested/a.txt')
        expect(found).toContain('nested/child/b.txt')
    })

    test('相对路径按会话当前目录算', async () => {
        await write_file.execute({ path: 'relative.txt', content: 'ok' }, { cwd: root })
        expect(await read_file.execute({ path: 'relative.txt' }, { cwd: root })).toBe('ok')
    })

    test('edit 单文件默认只替换一处，replaceAll 替换全部', async () => {
        const target = join(root, 'edit.txt')
        await writeFile(target, 'old\nold\n')

        await expect(edit.execute({ path: target, edits: [{ oldText: 'old', newText: 'new' }] }))
            .rejects.toThrow('exactly once')
        await edit.execute({ path: target, edits: [{ oldText: 'old', newText: 'new', replaceAll: true }] })
        expect(await readFile(target, 'utf8')).toBe('new\nnew\n')
    })

    test('edit 一次调用只改一个文件，任一条对不上就整体不改', async () => {
        const target = join(root, 'patch.txt')
        await writeFile(target, 'a0 b0')

        await edit.execute({ path: target, edits: [
            { oldText: 'a0', newText: 'a1' },
            { oldText: 'b0', newText: 'b1' },
        ] })
        expect(await readFile(target, 'utf8')).toBe('a1 b1')

        await expect(edit.execute({ path: target, edits: [
            { oldText: 'a1', newText: 'a2' },
            { oldText: 'missing', newText: 'b2' },
        ] })).rejects.toThrow('not found')
        expect(await readFile(target, 'utf8')).toBe('a1 b1')
    })

    test('edit 对同一文件的多条修改按顺序叠加', async () => {
        const target = join(root, 'stack.txt')
        await writeFile(target, 'a b')
        await edit.execute({ path: target, edits: [
            { oldText: 'a', newText: 'A' },
            { oldText: 'b', newText: 'B' },
        ] })
        expect(await readFile(target, 'utf8')).toBe('A B')
    })

    test('edit 对 CRLF 文件用 \\n 也能匹配，写回保持原行尾', async () => {
        const target = join(root, 'crlf.txt')
        await writeFile(target, 'one\r\ntwo\r\n')
        await edit.execute({ path: target, edits: [{ oldText: 'one\ntwo', newText: 'ONE\nTWO' }] })
        expect(await readFile(target, 'utf8')).toBe('ONE\r\nTWO\r\n')
    })

    test('search_text 使用 regex 和 filePattern', async () => {
        await writeFile(join(root, 'search.js'), 'const needle = 1\n')
        await writeFile(join(root, 'search.txt'), 'needle\n')
        const result = await search_text.execute({ path: root, regex: 'needle', filePattern: '*.js' }, {})
        expect(result).toContain('search.js')
        expect(result).not.toContain('search.txt')
    })

    test('search_text 的 context 返回命中前后几行', async () => {
        await writeFile(join(root, 'context.js'), 'before\nneedle\nafter\n')
        const result = await search_text.execute({ path: root, regex: 'needle', filePattern: 'context.js', context: 1 }, {})
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
        expect(await search_text.execute({ path: root, regex: 'needle', filePattern: 'bare.js' }))
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
