/*
 * 共用工具：文件系统判断和文本处理。
 *
 * 这两个模块的存在意义是"只有一份实现"，所以测试重点在边界：
 * symlink 目录要认得出来、子目录判断不能被前缀骗、截断要保住尾部的错误信息。
 * 运行：cd server && bun test tests/shared-utils.test.js
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, rm, symlink, writeFile as write } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Fs from '../utils/fs.js'
import Text from '../utils/text.js'

const root = join(tmpdir(), `agent-shared-${crypto.randomUUID()}`)
await mkdir(root, { recursive: true })

afterAll(async () => {
    await rm(root, { recursive: true, force: true })
})

describe('Fs 文件系统判断', () => {
    test('exists / isDirectory / isFile 认得出真实情况', async () => {
        const dir = join(root, 'a')
        const file = join(dir, 'x.txt')
        await mkdir(dir, { recursive: true })
        await write(file, 'hi')

        expect(await Fs.exists(dir)).toBe(true)
        expect(await Fs.exists(file)).toBe(true)
        expect(await Fs.exists(join(root, 'missing'))).toBe(false)
        expect(await Fs.isDirectory(dir)).toBe(true)
        expect(await Fs.isDirectory(file)).toBe(false)
        expect(await Fs.isFile(file)).toBe(true)
        expect(await Fs.isFile(dir)).toBe(false)
    })

    test('指向目录的符号链接被认成目录（这条决定技能目录能不能被发现）', async () => {
        const real = join(root, 'real-skills')
        const link = join(root, 'linked-skills')
        await mkdir(real, { recursive: true })
        try {
            await symlink(real, link, 'junction')
        } catch {
            return // 权限不足（Windows 非管理员）时跳过，不算失败
        }
        expect(await Fs.isDirectory(link)).toBe(true)
    })

    test('readJson 在文件缺失和内容损坏时都给 fallback', async () => {
        expect(await Fs.readJson(join(root, 'nope.json'), { a: 1 })).toEqual({ a: 1 })
        const broken = join(root, 'broken.json')
        await write(broken, '{not json')
        expect(await Fs.readJson(broken, 'fallback')).toBe('fallback')
    })

    test('writeJson 能建目录、能读回，且不留下临时文件', async () => {
        const target = join(root, 'deep/nested/data.json')
        await Fs.writeJson(target, { ok: true })
        expect(await Fs.readJson(target)).toEqual({ ok: true })
        const entries = await Fs.readJson(join(root, 'deep/nested/missing.json'), null)
        expect(entries).toBeNull()
        // 临时文件必须已经被 rename 掉
        const listing = await Array.fromAsync(new Bun.Glob('*.tmp-*').scan({ cwd: join(root, 'deep/nested') }))
        expect(listing).toEqual([])
    })

    test('inside 认子目录，且不被前缀名字骗', async () => {
        expect(Fs.inside('/a/b', '/a/b')).toBe(true)
        expect(Fs.inside('/a/b', '/a/b/c')).toBe(true)
        // /a/bc 不是 /a/b 的子目录——字符串前缀判断会在这里出错
        expect(Fs.inside('/a/b', '/a/bc')).toBe(false)
        expect(Fs.inside('/a/b', '/a')).toBe(false)
    })

    test('within 不含相等', async () => {
        expect(Fs.within('/a/b', '/a/b')).toBe(false)
        expect(Fs.within('/a/b', '/a/b/c')).toBe(true)
    })
})

describe('Text 文本处理', () => {
    test('短文本原样返回', () => {
        expect(Text.truncate('short', 100)).toBe('short')
    })

    test('长文本保留头尾，中间写明省略了多少', () => {
        const text = `${'A'.repeat(50)}${'B'.repeat(100)}${'C'.repeat(50)}`
        const result = Text.truncate(text, 100)
        expect(result.length).toBeLessThan(text.length)
        expect(result).toContain('A')            // 头部留着
        expect(result).toContain('C')            // 尾部留着——错误信息常在末尾
        expect(result).toContain('中间省略')
    })

    test('isObject 排除 null 和数组', () => {
        expect(Text.isObject({})).toBe(true)
        expect(Text.isObject(null)).toBe(false)
        expect(Text.isObject([])).toBe(false)
        expect(Text.isObject('x')).toBe(false)
    })

    test('textList 过滤非字符串并去掉空白项', () => {
        expect(Text.textList(['a', '', '  ', 1, null, ' b '])).toEqual(['a', 'b'])
        expect(Text.textList('not array')).toEqual([])
    })

    test('safeCount 挡住脏值', () => {
        expect(Text.safeCount(42)).toBe(42)
        expect(Text.safeCount('42')).toBe(42)
        expect(Text.safeCount(-1)).toBe(0)
        expect(Text.safeCount(Number.NaN)).toBe(0)
        expect(Text.safeCount(Infinity)).toBe(0)
        expect(Text.safeCount(999, { max: 100, fallback: -1 })).toBe(-1)
    })
})
