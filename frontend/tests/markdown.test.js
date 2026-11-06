/*
 * Markdown 渲染的行为检查：外链新开标签页、站内相对链接本页跳转。
 *
 * node --test 没有真实 DOM，dompurify 在 isSupported:false 时没有 sanitize，
 * 所以 renderMarkdown 在纯 node 里跑不通。这里直接测 src 导出的 linkRenderer
 * ——渲染器和测试共用同一份逻辑，行为改动不会让测试失真。
 * 运行：cd frontend && node --test tests/markdown.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = { location: { href: 'http://127.0.0.1:5173/', origin: 'http://127.0.0.1:5173' } }

const { linkRenderer } = await import('../src/utils/markdown.js')
const parser = { parseInline: tokens => tokens.map(t => t.text).join('') }

test('绝对 http(s) 外链新开标签页并断开 opener', () => {
    const html = linkRenderer({ href: 'https://github.com/kernel4632/agent-core/issues/20', tokens: [{ text: 'issue 20' }] }, parser)
    assert.match(html, /href="https:\/\/github\.com\/kernel4632\/agent-core\/issues\/20"/)
    assert.match(html, /target="_blank"/)
    assert.match(html, /rel="noopener noreferrer"/)
})

test('站内相对链接保持本页跳转，不加 target', () => {
    const html = linkRenderer({ href: '/settings', tokens: [{ text: '设置' }] }, parser)
    assert.match(html, /href="\/settings"/)
    assert.doesNotMatch(html, /target=/)
})

test('危险协议（javascript:）不生成可点击目标，文字保留', () => {
    const html = linkRenderer({ href: 'javascript:alert(1)', tokens: [{ text: '点我' }] }, parser)
    assert.doesNotMatch(html, /<a /)
    assert.match(html, /点我/)
})

test('带 title 属性的外链，target 和 title 同时保留', () => {
    const html = linkRenderer({ href: 'https://example.com', title: '示例', tokens: [{ text: '链接' }] }, parser)
    assert.match(html, /title="示例"/)
    assert.match(html, /target="_blank"/)
})
