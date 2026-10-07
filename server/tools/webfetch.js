/*
 * 网页读取工具：打开一个网址，把正文交给模型。
 *
 * 只读，不提交表单、不发 POST，避免模型顺手改了外部系统里的东西。
 * 调用示例：模型调用 webfetch({ url: 'https://example.com/docs' })。
 */
import { truncate } from './truncate.js' // 网页动辄几万字符，只留头尾。

// 一次请求最多等 30 秒，超时就当作读不到。
const TIMEOUT_MS = 30 * 1000

// --- 从 HTML 里取正文 ---
const toText = html => html
    .replace(/<script[\s\S]*?<\/script>/gi, '') // 脚本不是内容。
    .replace(/<style[\s\S]*?<\/style>/gi, '') // 样式不是内容。
    .replace(/<!--[\s\S]*?-->/g, '') // 注释不进入模型上下文。
    .replace(/<[^>]+>/g, ' ') // 其余标签换成空格，保留文字之间的间隔。
    .replace(/&nbsp;/g, ' ')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/&/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

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
    async execute({ url }, { abortSignal }) {
        const response = await fetch(url, { signal: AbortSignal.any([abortSignal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean)) })
        if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`)

        const body = await response.text()
        const type = response.headers.get('content-type') || ''
        // HTML 走正文提取；纯文本、JSON 这类原样给模型，避免把代码当标签删掉。
        const content = type.includes('html') ? toText(body) : body.trim()
        return truncate(`# ${url}\n\n${content}`)
    },
}
