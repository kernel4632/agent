/*
 * 网页读取工具：打开一个网址，把正文交给模型。
 *
 * 只读，不提交表单、不发 POST，避免模型顺手改了外部系统里的东西。
 * 调用示例：模型调用 webfetch({ url: 'https://example.com/docs' })。
 */
import { convert } from 'html-to-text' // 把网页转成正文；自己用正则删标签会把内容也删掉。
import { truncate } from './truncate.js' // 网页动辄几万字符，只留头尾。

// 一次请求最多等 30 秒，超时就当作读不到。
const TIMEOUT_MS = 30 * 1000

export default {
    name: 'webfetch',
    description: 'Fetch a web page and return its readable text content.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: '完整网址，以 http:// 或 https:// 开头' },
        },
        required: ['url'],
    },

    // --- 读取网页 ---
    async execute({ url }, { abortSignal } = {}) {
        const response = await fetch(url, { signal: AbortSignal.any([abortSignal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean)) })
        if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`)

        const body = await response.text()
        const type = response.headers.get('content-type') || ''
        // HTML 走正文提取；纯文本、JSON 这类原样给模型，它们本来就没有标签要处理。
        const content = type.includes('html') ? convert(body, { wordwrap: false }) : body.trim()
        return truncate(`# ${url}\n\n${content}`)
    },
}
