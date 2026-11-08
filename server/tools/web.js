/*
 * 网页工具：打开一个网址，把正文交给模型。
 *
 * 只读，不提交表单、不发 POST，避免模型顺手改了外部系统里的东西。
 * 没有配置搜索服务的 API Key 时不假装能搜索——需要搜索就接一个 MCP 搜索服务。
 *
 * 长网页默认只给头尾；传 query 时改成只给"和这个主题相关的段落"，
 * 这样读文档不用把整页塞进上下文再被截断。
 * 调用示例：模型调用 webfetch({ url: 'https://example.com/docs', query: 'rate limit' })
 */

import { convert } from 'html-to-text'

// 一次请求最多等 30 秒，超时就当作读不到。
const TIMEOUT_MS = 30 * 1000

// 返回给模型的字符上限：不传 maxChars 时用这个。
// 一个 1MB 的页面就是三十万 token，能一次性吃掉整个上下文窗口。
const DEFAULT_CHARS = 8000
const MAX_CHARS = 100000

// --- 网页太长时只留头尾 ---
const truncate = (text, limit = DEFAULT_CHARS) => {
    if (text.length <= limit) return text
    const half = Math.floor(limit / 2)
    return `${text.slice(0, half)}\n\n...（中间省略 ${text.length - half * 2} 个字符）...\n\n${text.slice(-half)}`
}

// --- 按主题挑段落：命中的段落连同它前后各一段一起给出 ---
// 比"从头截断"准得多：文档里真正要看的那一节常在很后面，而截断只保留开头。
const relevant = (content, query, limit) => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return ''
    // html-to-text 用空行分隔段落块（实测：标题、每段各自成块，块间夹空行）。
    // 按块而不是按行切：否则“前后各一行”会落在空行上，命中段的后文就拿不到。
    const blocks = content.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean)

    const hit = blocks.map((block, index) => {
        const text = block.toLowerCase()
        const score = terms.filter(term => text.includes(term)).length
        return { index, score }
    }).filter(item => item.score > 0)

    if (!hit.length) return ''

    // 保留命中块本身加前后各一块：单句脱离上下文经常没法判断。
    const wanted = new Set()
    for (const { index } of hit) {
        wanted.add(index - 1)
        wanted.add(index)
        wanted.add(index + 1)
    }
    const picked = [...wanted].filter(index => index >= 0 && index < blocks.length).sort((a, b) => a - b)
    return truncate(picked.map(index => blocks[index]).join('\n\n'), limit)
}

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
        'For a long page pass query: instead of dumping the whole page and then losing the middle to truncation, you get the paragraphs around that topic. A short specific phrase works better than loose keywords.',
        'This tool only reads a URL you already have. It does not search the web: to find a page, use a search service first, then fetch the URL it gives you.',
        'Parameters: - url (required): the address to fetch, starting with http:// or https://.',
        '- query (optional): topic to keep; matching paragraphs are returned instead of the page head and tail.',
        '- maxChars (optional): how many characters to return, default 8000, max 100000.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: '完整网址，以 http:// 或 https:// 开头' },
            query: { type: 'string', description: '只保留和这个主题相关的段落；不传就给头尾' },
            maxChars: { type: 'integer', minimum: 500, maximum: MAX_CHARS },
        },
        required: ['url'],
    },

    async execute({ url, query, maxChars }, options = {}) {
        const response = await fetch(url, { signal: AbortSignal.any([options.abortSignal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean)) })
        if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`)

        const body = await response.text()
        const type = response.headers.get('content-type') || ''
        // HTML 走正文提取；纯文本、JSON 这类原样给模型，它们本来就没有标签要处理。
        const content = type.includes('html') ? convert(body, { wordwrap: false }) : body.trim()
        const requested = Number(maxChars)
        const cap = Number.isFinite(requested) && requested >= 500 ? Math.min(MAX_CHARS, Math.floor(requested)) : DEFAULT_CHARS

        // 传了 query 就按段落挑相关的，而不是从头截——文档里真正要的那节常在很后面。
        if (typeof query === 'string' && query.trim()) {
            const picked = relevant(content, query.trim(), cap)
            if (!picked) {
                // 一段都没匹配上时不要返回空：如实说没找到，并把开头给出去让模型自己判断。
                return `# ${url}\n\n(No paragraph matched "${query}". Showing the beginning instead.)\n\n${truncate(content, cap)}`
            }
            return `# ${url}\n\n(Paragraphs matching "${query}")\n\n${picked}`
        }
        return truncate(`# ${url}\n\n${content}`, cap)
    },
}

export default webfetch
