/*
 * 历史消息查询工具：在本会话的历史里按关键词或正则找"当时确认过的事实"。
 *
 * 上下文压缩会丢掉前段的细节：确认过的文件路径、命令输出、当时为什么否掉某个方案。
 * 磁盘上的 history.json 本来就只增不删（全量存着），这个工具只是把已有数据
 * 暴露给模型，零新增存储。默认只搜当前会话；session_id 参数留作扩展位，
 * 跨会话检索（权限、隐私）正式版再考虑。
 *
 * 命中返回消息 id、角色、时间和命中片段（带上下文行，和 search_text 同一形状），
 * 模型拿到 id 之后可以用 read 工具按 id 定位，再决定要不要把那段读进上下文。
 *
 * 调用示例：
 *   模型调用 history_search({ query: 'restart-report' })
 *   模型调用 history_search({ query: '日志被.*覆盖', role: 'tool', limit: 5 })
 */

import { join } from 'node:path'
import Path from '../utils/path.js'

// 活跃历史 + 已封存分块按顺序拼回；搜索不能只搜最近窗口。
const readMessages = async sessionId => {
    const records = []
    const index = await Bun.file(Path.historyIndex(sessionId)).json().catch(() => null)
    for (const archive of index?.archives || []) {
        const chunk = await Bun.file(join(Path.historyArchives(sessionId), archive.file)).json().catch(() => null)
        if (Array.isArray(chunk?.messages)) records.push(...chunk.messages)
    }
    const active = await Bun.file(Path.history(sessionId)).json().catch(() => null)
    if (Array.isArray(active?.messages)) records.push(...active.messages)
    const seen = new Set()
    return records.filter(record => {
        const id = record?.messageId
        if (id && seen.has(id)) return false
        if (id) seen.add(id)
        return true
    })
}

// 每条命中的摘录最多带多少字符；超过就掐断，命中详情用 read 工具看全文。
const MAX_SNIPPET = 400
// 一次最多返回多少条命中；防止一个宽泛的关键词把上下文撑爆。
const MAX_MATCHES = 30

// --- 把一段文本里所有命中位置连同前后几行摘出来 ---
const snippets = (text, matcher, around = 0) => {
    const lines = String(text ?? '').split('\n')
    const out = []
    lines.forEach((line, index) => {
        if (!matcher.test(line)) return
        const from = Math.max(0, index - around)
        const to = Math.min(lines.length, index + around + 1)
        const context = lines.slice(from, to).join('\n')
        out.push({ line: index + 1, snippet: context.length > MAX_SNIPPET ? `${context.slice(0, MAX_SNIPPET)}…` : context })
    })
    return out
}

// --- 把一条消息的内容块拍平成可搜索的文本；工具输入/结果里的 JSON 也拍进去 ---
const textOf = message => {
    const parts = Array.isArray(message?.content) ? message.content : []
    const chunks = []
    for (const part of parts) {
        if (typeof part?.text === 'string') chunks.push(part.text)
        if (part?.type === 'tool-call' || part?.type === 'tool-result') {
            chunks.push(`${part.toolName ?? ''} ${JSON.stringify(part.input ?? part.output ?? '')}`)
        }
        if (part?.type === 'reasoning' && typeof part?.text === 'string') chunks.push(part.text)
    }
    if (typeof message?.content === 'string') chunks.push(message.content)
    return chunks.filter(Boolean).join('\n')
}

const search = {
    name: 'history_search',
    kind: 'read',
    ui: {
        view: 'search',
        icon: 'search',
        title: '搜索历史',
        summary: '{query}',
    },
    description: [
        'Search this conversation\'s own history by keyword or regular expression.',
        'Use it after a context compaction: find the file paths, command outputs and decisions that were confirmed earlier but dropped from context.',
        'Returns matches as { messageId, role, time, line, snippet } — use the id to locate the message and decide whether to pull that part back in.',
        'Searches the current session only. Sorts newest first.',
        'Parameters: - query (required): keyword or regular expression. - role (optional): filter by message role (user/assistant/tool). - limit (optional): max matches, default 10, max 30.',
    ].join('\n'),
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '关键词或正则（会按正则解析，解析失败按字面文本找）' },
            role: { type: 'string', enum: ['user', 'assistant', 'tool'] },
            limit: { type: 'integer', minimum: 1, maximum: 30 },
        },
        required: ['query'],
    },

    // 第二参由工具宿主注入：sessionId、cwd 都在这里。
    async execute({ query, role, limit = 10 }, options = {}) {
        if (typeof query !== 'string' || !query.trim()) throw new Error('query is required')
        if (!options.sessionId) throw new Error('history_search needs a session context')

        // 正则解析失败就按字面文本找：模型写了个半成品正则不该整个失败。
        let matcher
        try {
            matcher = new RegExp(query, 'i')
        } catch {
            matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        }

        const messages = await readMessages(options.sessionId)
        const size = Math.min(MAX_MATCHES, Math.max(1, Math.floor(Number(limit) || 10)))
        const matches = []

        // 扁平的命中列表：一条 = 一个命中位置，消息 id/角色直接在上面，模型不用剥两层。
        for (let index = messages.length - 1; index >= 0 && matches.length < size; index -= 1) {
            const { message } = messages[index] ?? {}
            if (!message || message.internal) continue
            if (role && message.role !== role) continue
            for (const hit of snippets(textOf(message), matcher)) {
                matches.push({ messageId: message.id, role: message.role, time: message.time ?? null, ...hit })
                if (matches.length >= size) break
            }
        }

        return { matches, total: matches.length }
    },
}

export default search
