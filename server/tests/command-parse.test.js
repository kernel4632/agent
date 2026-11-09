/*
 * 命令解析：引号分词、判断是否需要 shell。
 *
 * 这一层是 execute_command 的语义基础，所以边界情况要逐个锁住：
 * 带空格的参数必须是一个整体，而管道/重定向/变量这些真需要 shell 的不能被当普通参数。
 * 运行：cd server && bun test tests/command-parse.test.js
 */
import { describe, expect, test } from 'bun:test'

import { parse, executable } from '../utils/command.js'

describe('引号分词', () => {
    test('双引号里的空格不切开参数', () => {
        const result = parse('gh issue close 34 -r "not planned"', { windows: false })
        expect(result.ok).toBe(true)
        expect(result.needsShell).toBe(false)
        expect(result.argv).toEqual(['gh', 'issue', 'close', '34', '-r', 'not planned'])
    })

    test('单引号同样保护空格', () => {
        const result = parse("echo 'hello world'", { windows: false })
        expect(result.argv).toEqual(['echo', 'hello world'])
    })

    test('Windows 下双引号也保护空格（这是修的那个 bug）', () => {
        const result = parse('gh issue close 34 -r "not planned"', { windows: true })
        expect(result.argv).toEqual(['gh', 'issue', 'close', '34', '-r', 'not planned'])
        expect(result.needsShell).toBe(false)
    })

    test('空引号是一个空参数，不是没有参数', () => {
        expect(parse('cmd "" x', { windows: false }).argv).toEqual(['cmd', '', 'x'])
        expect(parse("cmd '' x", { windows: false }).argv).toEqual(['cmd', '', 'x'])
    })

    test('相邻引号与裸字拼成同一个参数', () => {
        const result = parse('cmd --path=a"b c"d', { windows: false })
        expect(result.argv).toEqual(['cmd', '--path=ab cd'])
    })

    test('引号里的 shell 字符是普通字符，不触发 shell', () => {
        const result = parse('git commit -m "a | b > c"', { windows: false })
        expect(result.needsShell).toBe(false)
        expect(result.argv).toEqual(['git', 'commit', '-m', 'a | b > c'])
    })

    test('POSIX 反斜杠转义空格', () => {
        const result = parse('cat my\\ file.txt', { windows: false })
        expect(result.argv).toEqual(['cat', 'my file.txt'])
    })

    test('Windows 下反斜杠是路径分隔符，不是转义', () => {
        const result = parse('type C:\\a b\\c.txt', { windows: true })
        expect(result.argv).toEqual(['type', 'C:\\a', 'b\\c.txt'])
    })

    test('引号没闭合时交给 shell 处理，不猜', () => {
        const result = parse('echo "unclosed', { windows: false })
        expect(result.ok).toBe(false)
        expect(result.needsShell).toBe(true)
    })
})

describe('需要 shell 的判定', () => {
    test('管道', () => {
        const result = parse('bun test | tail -20', { windows: false })
        expect(result.needsShell).toBe(true)
        expect(result.reason).toBe('|')
    })

    test('重定向', () => {
        expect(parse('bun test 2>&1', { windows: false }).needsShell).toBe(true)
        expect(parse('ls > out.txt', { windows: false }).needsShell).toBe(true)
    })

    test('用 && 串接', () => {
        expect(parse('cd a && bun test', { windows: false }).needsShell).toBe(true)
    })

    test('变量与命令替换', () => {
        expect(parse('echo $HOME', { windows: false }).needsShell).toBe(true)
        expect(parse('echo `date`', { windows: false }).needsShell).toBe(true)
    })

    test('通配符', () => {
        expect(parse('rm *.log', { windows: false }).needsShell).toBe(true)
    })

    test('Windows 的 %VAR% 也算', () => {
        expect(parse('echo %PATH%', { windows: true }).needsShell).toBe(true)
        // POSIX 下 % 是普通字符
        expect(parse('echo 100%', { windows: false }).needsShell).toBe(false)
    })

    test('普通命令不需要 shell', () => {
        expect(parse('bun test', { windows: false }).needsShell).toBe(false)
        expect(parse('git status --short', { windows: false }).needsShell).toBe(false)
        expect(parse('node -e "console.log(1)"', { windows: false }).needsShell).toBe(false)
    })
})

describe('可执行文件判定', () => {
    test('PATH 里有的命令认得出来', () => {
        // bun 一定存在（测试本身就跑在 bun 上）
        expect(executable('bun')).toBe(true)
    })

    test('不存在的命令认不出来', () => {
        expect(executable('definitely-not-a-real-command-xyz')).toBe(false)
    })

    test('空字符串不算', () => {
        expect(executable('')).toBe(false)
    })
})
