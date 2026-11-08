/*
 * webfetch 工具：query 按段落挑内容、maxChars 封顶、没匹配上时的兜底。
 *
 * 全部用本地假 HTTP 服务，不访问真实网络——测试不能因为外网抖动而变红。
 * 运行：cd server && bun test tests/web-fetch.test.js
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import webfetch from '../tools/web.js'

// 一个够长的 HTML 页面：目标内容故意放在很靠后的位置，
// 这样如果实现退化成"只保留头尾"，测试会失败。
const paragraphs = Array.from({ length: 40 }, (_, index) => `<p>前言段落 ${index} 填充内容填充内容填充内容</p>`).join('')
const page = `<html><body>${paragraphs}<h2>Rate limits</h2><p>The API allows 100 requests per minute per key.</p><p>Exceeding it returns HTTP 429.</p></body></html>`

let server
let base

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === '/page') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
            if (url.pathname === '/plain') return new Response('纯文本内容', { headers: { 'content-type': 'text/plain' } })
            return new Response('not found', { status: 404 })
        },
    })
    base = `http://127.0.0.1:${server.port}`
})

afterAll(() => { server?.stop(true) })

describe('webfetch', () => {
    test('不传 query 时给正文', async () => {
        const text = await webfetch.execute({ url: `${base}/page` }, {})
        expect(text).toContain('前言段落 0')
        expect(text).not.toContain('<p>')      // 标签被剥掉
    })

    test('纯文本原样返回，不当 HTML 处理', async () => {
        const text = await webfetch.execute({ url: `${base}/plain` }, {})
        expect(text).toContain('纯文本内容')
    })

    test('传 query 时挑出相关段落，而不是只留开头', async () => {
        // 用正文里的词，不用标题：html-to-text 会把标题转成大写，
        // 拿标题词做 query 测的就不是“挑段落”这件事了。
        const text = await webfetch.execute({ url: `${base}/page`, query: 'requests per minute' }, {})
        // 目标内容在页面很后面；能拿到就说明是按主题挑的
        expect(text).toContain('100 requests per minute')
        // 命中块的下一块也一起带出来（前后各一段的上下文）
        expect(text).toContain('HTTP 429')
        // 不应该把 40 段前言全带上
        expect(text).not.toContain('前言段落 39')
    })

    test('query 大小写不敏感', async () => {
        const upper = await webfetch.execute({ url: `${base}/page`, query: 'REQUESTS PER MINUTE' }, {})
        expect(upper).toContain('100 requests per minute')
    })

    test('query 一段都没命中时如实说明，并给开头兜底', async () => {
        const text = await webfetch.execute({ url: `${base}/page`, query: 'nonexistent-topic-xyz' }, {})
        expect(text).toContain('No paragraph matched')
        expect(text).toContain('前言段落 0')
    })

    test('maxChars 封顶生效', async () => {
        const text = await webfetch.execute({ url: `${base}/page`, maxChars: 500 }, {})
        // 截断时会写省略说明，整体长度也受控
        expect(text.length).toBeLessThan(1200)
        expect(text).toContain('中间省略')
    })

    test('404 报错而不是返回空内容', async () => {
        await expect(webfetch.execute({ url: `${base}/missing` }, {})).rejects.toThrow(/404/)
    })
})
