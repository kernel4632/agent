/*
 * 历史消息查询工具：上下文压缩后把"当时确认过的细节"翻回来。
 *
 * 数据就是会话自己的 history.json，不建第二份存储。
 * 运行：cd server && bun test tests/history-tool.test.js
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import History from '../features/history.js'
import Path from '../utils/path.js'
import search from '../tools/history.js'

// 直接写 history.json 到一个临时目录，不经过会话流程（工具只读这份文件）。
const writeHistory = async (sessionId, messages) => {
    process.env.AGENT_HOME = join(__dirname, '.tmp-history-' + crypto.randomUUID().slice(0, 8))
    const file = Path.history(sessionId)
    await Bun.write(file, JSON.stringify({ messages: messages.map(m => ({ messageId: m.id, message: m })), redo: [] }))
}

describe('history_search', () => {
    test('按关键词找到命中，返回消息 id、角色和片段', async () => {
        const sessionId = 's1'
        await writeHistory(sessionId, [
            { id: 'u1', role: 'user', content: [{ type: 'text', text: '帮我确认 restart-report 里写了什么' }] },
            { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '报告说 SERVER_OK，版本 0.58.13' }] },
            { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '另一段话' }] },
        ])
        const result = await search.execute({ query: 'restart-report' }, { sessionId })
        expect(result.total).toBe(1)
        expect(result.matches[0].messageId).toBe('u1')
        expect(result.matches[0].snippet).toContain('restart-report')
    })

    test('正则匹配，坏正则按字面文本找', async () => {
        const sessionId = 's2'
        await writeHistory(sessionId, [
            { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '用了 PORT=3111 重启成功' }] },
        ])
        const regex = await search.execute({ query: 'PORT=\\d+' }, { sessionId })
        expect(regex.total).toBe(1)

        // 括号没闭合是坏正则：按字面找，不报错。
        const literal = await search.execute({ query: 'PORT=(3111' }, { sessionId })
        expect(literal.total).toBe(0)
    })

    test('role 过滤和 limit 都生效，最新的排前面', async () => {
        const sessionId = 's3'
        await writeHistory(sessionId, [
            { id: 'u1', role: 'user', content: [{ type: 'text', text: '查 token 用量' }] },
            { id: 't1', role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'usage', output: { type: 'json', value: { tokens: 500 } } }] },
            { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'token 用量见工具结果' }] },
            { id: 'u2', role: 'user', content: [{ type: 'text', text: '再看一次 token' }] },
        ])
        const onlyUser = await search.execute({ query: 'token', role: 'user' }, { sessionId })
        expect(onlyUser.matches.map(m => m.messageId)).toEqual(['u2', 'u1'])   // 最新的在前

        const limited = await search.execute({ query: 'token', limit: 1 }, { sessionId })
        expect(limited.total).toBe(1)
        expect(limited.matches[0].messageId).toBe('u2')
    })

    test('工具调用的输入和输出都能被搜到', async () => {
        const sessionId = 's4'
        await writeHistory(sessionId, [
            { id: 'a1', role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', input: { path: 'src/config.js' } }] },
        ])
        const result = await search.execute({ query: 'config\\.js' }, { sessionId })
        expect(result.total).toBe(1)
        expect(result.matches[0].snippet).toContain('read_file')
    })

    test('internal 消息不进结果；没有历史文件返回空', async () => {
        const sessionId = 's5'
        await writeHistory(sessionId, [
            { id: 'i1', role: 'user', internal: true, content: [{ type: 'text', text: '内部提示 token' }] },
            { id: 'u1', role: 'user', content: [{ type: 'text', text: '用户真的说过 token' }] },
        ])
        const result = await search.execute({ query: 'token' }, { sessionId })
        expect(result.total).toBe(1)
        expect(result.matches[0].messageId).toBe('u1')

        const empty = await search.execute({ query: '随便' }, { sessionId: 'no-such-session' })
        expect(empty.total).toBe(0)
        expect(empty.matches).toEqual([])
    })

    test('缺 query 或缺会话上下文按填错处理', async () => {
        await expect(search.execute({ query: ' ' }, { sessionId: 's1' })).rejects.toThrow(/query/)
        await expect(search.execute({ query: 'x' }, {})).rejects.toThrow(/session/)
    })
})
