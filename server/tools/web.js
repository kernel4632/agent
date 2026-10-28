/*
 * 网页工具：打开一个网址，把正文交给模型。
 *
 * 只读，不提交表单、不发 POST，避免模型顺手改了外部系统里的东西。
 * 没有配置搜索服务的 API Key 时不假装能搜索——需要搜索就接一个 MCP 搜索服务。
 * 调用示例：模型调用 webfetch({ url: 'https://example.com/docs' })
 */

import { convert } from 'html-to-text'
import { truncate } from '../utils/text.js'

// 一次请求最多等 30 秒，超时就当作读不到。
const TIMEOUT_MS = 30 * 1000

const webfetch = {
    name: 'webfetch',
    kind: 'read',
    ui: {
        view: 'web',
        icon: 'globe',
        title: '读取网页',
        summary: '{url}',
        actions: [
            { id: 'open-url', label: '打开网页', icon: 'globe', type: 'open', value: 'url' },
            { id: 'copy-url', label: '复制网址', icon: 'copy', type: 'copy', value: 'url' },
        ],
    },
    description: [
        'Fetch a web page over HTTP(S) and return its readable text content, with markup stripped.',
        'The whole page becomes one text block; very long pages are truncated. It returns content only — no login, no POST bodies.',
        'Parameters: - url (required): the address to fetch, starting with http:// or https://.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: '完整网址，以 http:// 或 https:// 开头' },
        },
        required: ['url'],
    },

    async execute({ url }, options = {}) {
        const response = await fetch(url, { signal: AbortSignal.any([options.abortSignal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean)) })
        if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`)

        const body = await response.text()
        const type = response.headers.get('content-type') || ''
        // HTML 走正文提取；纯文本、JSON 这类原样给模型，它们本来就没有标签要处理。
        const content = type.includes('html') ? convert(body, { wordwrap: false }) : body.trim()
        return truncate(`# ${url}\n\n${content}`)
    },
}

export default webfetch
