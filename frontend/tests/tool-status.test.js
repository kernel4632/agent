/*
 * 工具状态回归测试：历史归一化和实时 SSE 必须给出同一个 status 和同一段结果文本。
 * 重点盯被拒绝的 attempt_completion：它只是失败的工具步骤，不能被当成正常收尾。
 */
import { History } from '../src/commands/history.js'

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Chat } from '../src/commands/chat.js'
import { store } from '../src/store.js'
import { toolStatus, formatToolOutput } from '../src/commands/tool.js'
import { hasStopTool, isFinishedStopTool } from '../src/commands/history.js'
import { sessionStats } from '../src/commands/stats.js'

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
        const normalized = History.normalize({ id: 'session-1', history: historyFor(example) }).messages[0].tools[0]
        const live = await liveTool(example)

        assert.equal(normalized.status, example.status, example.name)
        assert.equal(normalized.preview, example.preview, example.name)
        assert.deepEqual(live.output, example.output, example.name)
        assert.equal(live.status, normalized.status, example.name)
        assert.equal(live.preview, normalized.preview, example.name)
    }
})

test('历史归一化保留正文和工具的原始顺序', () => {
    const normalized = History.normalize({
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

test('历史里的模型请求在时间线开头占一个位置', () => {
    const normalized = History.normalize({
        id: 'session-1',
        history: [{
            messageId: 'message-1',
            role: 'assistant',
            content: '回答',
            usage: { input: 3, output: 2, total: 5 },
        }],
    })
    const [message] = normalized.messages
    assert.equal(message.steps[0].type, 'request')
    assert.equal(message.steps[0].requestId, 'request_message-1')
    assert.equal(message.requests[0].total, 5)
})

test('历史里的用户附件只留下文件名，附件正文仍保留给回退', () => {
    const raw = '看看附件\n\n附件 "a.txt":\nsecret'
    const normalized = History.normalize({
        id: 'session-1',
        history: [{ messageId: 'user-1', role: 'user', content: raw }],
    })
    assert.equal(normalized.messages[0].displayContent, '看看附件')
    assert.equal(normalized.messages[0].content, raw)
    assert.deepEqual(normalized.messages[0].attachments, [{ name: 'a.txt' }])
})

test('被拒绝的 attempt_completion 不算收尾，继续按钮才会出现', async () => {
    const normalized = History.normalize({ id: 'session-1', history: historyFor(cases[0]) }).messages
    const tool = normalized[0].tools[0]

    assert.equal(tool.status, 'rejected')
    assert.equal(isFinishedStopTool(tool), false)
    assert.equal(hasStopTool(normalized), false)
    // 正常完成的结束工具仍然算收尾，正文直接显示它的结果。
    const finished = { name: 'attempt_completion', status: 'completed', output: { type: 'text', value: '最终结果' } }
    assert.equal(isFinishedStopTool(finished), true)
})

test('刷新后压缩用量进入总计，压缩请求不覆盖主模型上下文用量', () => {
    const session = History.normalize({ id: 'compact-usage', history: [
        { id: 'u1', role: 'user', content: '任务' },
        { id: 'a1', role: 'assistant', content: '回答', usage: { input: 11, output: 3, total: 14 } },
        { id: 'c1', role: 'user', compact: true, content: '总结', usage: { input: 7, output: 2, total: 9 } },
    ] })
    assert.equal(session.inputTokens, 18)
    assert.equal(session.outputTokens, 5)
    assert.equal(session.contextTokens, 11)
    assert.equal(session.messages.at(-1).requests[0].total, 9)
    assert.equal(sessionStats(session).usage.total, 23)
    assert.equal(sessionStats(session).usage.requests, 2)
    assert.equal(sessionStats(session).context.used, 11)
})

test('压缩流增量不会混进助手正文或思考', async () => {
    const sessionID = `compact-${crypto.randomUUID()}`
    store.sessions[sessionID] = { id: sessionID, messages: [], status: 'running', connection: 'connected', lastEventAt: 0, files: [] }
    try {
        await Chat.receive(sessionID, { type: 'compact-start', messages: 5 })
        await Chat.receive(sessionID, { type: 'text-delta', text: '上下文摘要', request: 'compact' })
        await Chat.receive(sessionID, { type: 'reasoning-delta', text: '摘要推理', request: 'compact' })

        const compactMessage = store.sessions[sessionID].messages[0]
        assert.equal(compactMessage.content, '')
        assert.equal(compactMessage.reasoning, '')
        const compact = compactMessage.steps.find(step => step.type === 'compact')
        assert.equal(compact.request.content, '上下文摘要')
        assert.equal(compact.request.reasoning, '摘要推理')

        await Chat.receive(sessionID, { type: 'text-delta', text: '真实回答' })
        assert.equal(store.sessions[sessionID].messages.length, 1)
        assert.equal(store.sessions[sessionID].messages[0].content, '真实回答')
        assert.equal(store.sessions[sessionID].messages[0].reasoning, '')
    } finally {
        delete store.sessions[sessionID]
    }
})

test('history restores nested subagent tool steps', () => {
  const session = History.normalize({
    provider: 'test', model: 'm',
    history: [{
      messageId: 'a1', role: 'assistant',
      parts: [{
        type: 'tool-call', toolCallId: 'task-1', toolName: 'new_task', state: 'result',
        result: { output: { type: 'json', value: { description: '查资料', steps: [
          { id: 'read-1', type: 'tool', name: 'read_file', input: { path: 'a.txt' }, output: { type: 'text', value: '内容' }, status: 'completed' },
        ] } } },
      }],
    }],
  })
  const tool = session.messages[0].tools[0]
  assert.equal(tool.subagentSteps.length, 1)
  assert.equal(tool.subagentSteps[0].name, 'read_file')
  assert.match(tool.subagentSteps[0].preview, /内容/)
})
