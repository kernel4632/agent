/*
 * 工具状态回归测试：历史归一化和实时 SSE 必须给出同一个 status 和同一段结果文本。
 * 重点盯被拒绝的 attempt_completion：它只是失败的工具步骤，不能被当成正常收尾。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Chat } from '../src/session/chat.js'
import { Session } from '../src/session/session.js'
import { store } from '../src/store.js'
import { toolStatus, formatToolOutput } from '../src/session/tool-ui.js'
import { hasStopTool, isFinishedStopTool } from '../src/session/stop-tools.js'

const cases = [
    {
        name: 'execution-denied',
        output: { type: 'execution-denied', reason: '用户拒绝这次操作' },
        isError: false,
        status: 'rejected',
        preview: '用户拒绝这次操作',
    },
    {
        name: 'error-text',
        output: { type: 'error-text', value: '命令执行失败' },
        isError: false,
        status: 'error',
        preview: '命令执行失败',
    },
    {
        name: 'error-json',
        output: { type: 'error-json', value: { message: '失败了' } },
        isError: false,
        status: 'error',
        preview: JSON.stringify({ message: '失败了' }, null, 2),
    },
    {
        name: 'isError',
        output: { type: 'json', value: { message: '失败了' } },
        isError: true,
        status: 'error',
        preview: JSON.stringify({ message: '失败了' }, null, 2),
    },
    {
        name: 'completed',
        output: { type: 'text', value: '最终结果' },
        isError: false,
        status: 'completed',
        preview: '最终结果',
    },
]

const historyFor = ({ output, isError }) => [{
    messageId: 'message-1',
    id: 'assistant-1',
    role: 'assistant',
    content: [{
        type: 'tool-invocation',
        toolCallId: 'call-1',
        toolName: 'attempt_completion',
        state: 'result',
        args: { result: '结果' },
        result: { output, isError },
    }],
}]

const liveTool = async ({ output, isError }) => {
    const sessionID = `live-${crypto.randomUUID()}`
    store.sessions[sessionID] = { id: sessionID, messages: [], status: 'running', connection: 'connected', lastEventAt: 0, files: [] }
    await Chat.receive(sessionID, { type: 'tool-call', toolCallId: 'call-1', toolName: 'attempt_completion', input: { result: '结果' } })
    await Chat.receive(sessionID, { type: 'tool-result', toolCallId: 'call-1', toolName: 'attempt_completion', output, isError })
    return store.sessions[sessionID].messages.flatMap(message => message.tools || [])[0]
}

test('toolStatus 把拒绝、失败和正常结果分开', () => {
    assert.equal(toolStatus({ type: 'execution-denied' }), 'rejected')
    assert.equal(toolStatus({ type: 'error-text' }), 'error')
    assert.equal(toolStatus({ type: 'text', value: 'ok' }, true), 'error')
    assert.equal(toolStatus({ type: 'text', value: 'ok' }), 'completed')
    assert.equal(formatToolOutput({ type: 'execution-denied', reason: '拒绝原因' }), '拒绝原因')
})

test('历史归一化和实时事件得到相同的工具状态和文本', async () => {
    for (const example of cases) {
        const normalized = Session.normalize({ id: 'session-1', history: historyFor(example) }).messages[0].tools[0]
        const live = await liveTool(example)

        assert.equal(normalized.status, example.status, example.name)
        assert.equal(normalized.preview, example.preview, example.name)
        assert.deepEqual(live.output, example.output, example.name)
        assert.equal(live.status, normalized.status, example.name)
        assert.equal(live.preview, normalized.preview, example.name)
    }
})

test('历史归一化保留正文和工具的原始顺序', () => {
    const normalized = Session.normalize({
        id: 'session-1',
        history: [{
            messageId: 'message-1',
            id: 'assistant-1',
            role: 'assistant',
            content: [
                { type: 'reasoning', text: '先想' },
                { type: 'text', text: '第一段' },
                { type: 'tool-invocation', toolCallId: 'call-1', toolName: 'read_file', state: 'call', args: { path: 'a' } },
                { type: 'text', text: '第二段' },
            ],
        }],
    })
    assert.deepEqual(normalized.messages[0].steps.map(step => step.type), ['reasoning', 'text', 'tool', 'text'])
})

test('历史里的用户附件只留下文件名，附件正文仍保留给回退', () => {
    const raw = '看看附件\n\n附件 "a.txt":\nsecret'
    const normalized = Session.normalize({
        id: 'session-1',
        history: [{ messageId: 'user-1', role: 'user', content: raw }],
    })
    assert.equal(normalized.messages[0].displayContent, '看看附件')
    assert.equal(normalized.messages[0].content, raw)
    assert.deepEqual(normalized.messages[0].attachments, [{ name: 'a.txt' }])
})

test('被拒绝的 attempt_completion 不算收尾，继续按钮才会出现', async () => {
    const normalized = Session.normalize({ id: 'session-1', history: historyFor(cases[0]) }).messages
    const tool = normalized[0].tools[0]

    assert.equal(tool.status, 'rejected')
    assert.equal(isFinishedStopTool(tool), false)
    assert.equal(hasStopTool(normalized), false)
    // 正常完成的结束工具仍然算收尾，正文直接显示它的结果。
    const finished = { name: 'attempt_completion', status: 'completed', output: { type: 'text', value: '最终结果' } }
    assert.equal(isFinishedStopTool(finished), true)
})
