/*
抓一个网页。只允许 http/https GET，超时 15 秒。HTML 剥成可读文本，过长截断。
不跟跳到别的协议，重定向由 fetch 自己处理。
*/

import { truncate } from './common.js'

const LIMIT = 20000
const TIMEOUT = 15000

/** @param {string} html */
function strip(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<\/(p|div|h[1-6]|li|tr|br|blockquote)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ')
        .trim()
}

export default {
    name: 'webfetch',
    description: '用 GET 抓取一个 http(s) 网址，返回纯文本。不要用来请求内网或带密钥的地址。',
    parameters: {
        type: 'object',
        properties: {
            url: { type: 'string' },
            maxBytes: { type: 'integer', description: '最多保留多少字符，默认 20000' },
        },
        required: ['url'],
    },
    /** @param {{ url?: string, maxBytes?: number }} [args] */
    async run({ url, maxBytes } = {}) {
        if (!url || !/^https?:\/\//i.test(url)) throw new Error('只允许 http 或 https 地址')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT)
        try {
            const response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers: { 'user-agent': 'agent-webfetch/1' } })
            const type = response.headers.get('content-type') || ''
            const raw = await response.text()
            const text = /html/i.test(type) ? strip(raw) : raw
            return { url, status: response.status, contentType: type, text: truncate(text, maxBytes || LIMIT) }
        } finally {
            clearTimeout(timer)
        }
    },
}
