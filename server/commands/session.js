/* 
// 创建会话
await Session.create({
    title: "写爬虫",
})
// result = { sessionId: "session-1" }

// 删除会话
await Session.remove({
    sessionId: "session-1",
})
// 读取会话
await Session.read({
    sessionId: "session-1",
})
// result = {
//     id: "session-1",
//     title: "写爬虫",
//     history: [...]
// }

// 重命名会话
await Session.rename({
    sessionId: "session-1",
    title: "写爬虫脚本",
})

// 回退会话历史
await Session.rollback({
    sessionId: "session-1",
    messageId: "message-2",     // 回退到这条消息之前
})


// 撤销上一次回退
await Session.redo({
    sessionId: "session-1",
})


// 用户主动压缩当前会话
await Session.compact({
    sessionId: "session-1",
    maxTokens: 8000,             // 压缩后的最大上下文长度
})
  */

import { mkdir, rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { writeFile } from 'atomically'
import Agent from './agent.js'
import Config from './config.js'
import Context from '../features/context.js'
import Compact from '../features/compact.js'
import History from '../features/history.js'
import Permission from '../features/permission.js'
import Path from '../utils/path.js'
import Tool from '../features/tool.js'
import SSE from '../utils/sse.js'

const agents = new Map()

const readMeta = async sessionId => {
    const file = Bun.file(Path.meta(sessionId))
    if (!await file.exists()) throw new Error(`Session not found: ${sessionId}`)
    return file.json()
}

const writeMeta = async meta => {
    await mkdir(Path.session(meta.id), { recursive: true })
    await writeFile(Path.meta(meta.id), JSON.stringify(meta, null, 2))
    return meta
}

const firstModel = () => {
    const provider = (Config.get().providers || []).find(item => item.enabled !== false)
    const model = provider?.models?.[0]
    return {
        provider: provider?.name || '',
        model: typeof model === 'string' ? model : model?.id || '',
    }
}

const agentConfig = ({ providerName, model }) => {
    const global = Config.get()
    const provider = (global.providers || []).find(item => item.name === providerName)
    let headers = provider?.headers || {}
    if (typeof headers === 'string') headers = JSON.parse(headers || '{}')
    const settings = provider?.modelSettings?.[model] || {}
    return {
        baseURL: provider?.baseURL || '',
        apiKey: provider?.apiKey || provider?.key || '',
        model,
        protocol: provider?.protocol === 'openai-compatible' ? 'chat' : provider?.protocol || 'chat',
        headers,
        body: provider?.body || {},
        maxTokens: settings.context || settings.contextWindow || 128000,
        stream: provider?.stream ?? global.stream ?? true,
        system: global.prompt?.system || '',
    }
}

const create = async ({ title, workspaceId, provider, model }) => {
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('title must be a non-empty string')
    const selected = firstModel()
    const meta = {
        id: nanoid(),
        title: title.trim(),
        workspaceId,
        provider: provider || selected.provider,
        model: model || selected.model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }

    await writeMeta(meta)
    await History.load({ sessionId: meta.id })
    await History.save({ sessionId: meta.id })
    await mkdir(Path.tools(), { recursive: true })
    agents.set(meta.id, Agent.create({
        id: meta.id,
        history: History.get({ sessionId: meta.id }),
        config: agentConfig({ providerName: meta.provider, model: meta.model }),
        tools: await Tool.scan(Path.tools()),
        callbacks: { onPermission: Permission.check },
    }))
    return { sessionId: meta.id }
}

const read = async ({ sessionId }) => {
    const meta = await readMeta(sessionId)
    const agent = agents.get(sessionId)
    await History.load({ sessionId })
    const history = History.get({ sessionId })
    if (agent?.running) return { ...meta, history: agent.history }
    if (agent && !agent.running) agent.history = history
    if (!agent) agents.set(sessionId, Agent.create({
        id: sessionId,
        history,
        config: agentConfig({ providerName: meta.provider, model: meta.model }),
        tools: (await mkdir(Path.tools(), { recursive: true }), await Tool.scan(Path.tools())),
        callbacks: { onPermission: Permission.check },
    }))
    return { ...meta, history }
}

const rename = async ({ sessionId, title }) => {
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('title must be a non-empty string')
    const meta = await readMeta(sessionId)
    meta.title = title.trim()
    meta.updatedAt = Date.now()
    return writeMeta(meta)
}

const remove = async ({ sessionId }) => {
    await readMeta(sessionId)
    if (agents.get(sessionId)?.running) throw new Error(`Agent is already running: ${sessionId}`)
    agents.delete(sessionId)
    await rm(Path.session(sessionId), { recursive: true, force: true })
    return { ok: true }
}

const rollback = async ({ sessionId, messageId }) => {
    await readMeta(sessionId)
    if (agents.get(sessionId)?.running) throw new Error(`Agent is already running: ${sessionId}`)
    await History.load({ sessionId })
    await History.rollback({ sessionId, messageId })
    await History.save({ sessionId })
    if (agents.has(sessionId)) agents.get(sessionId).history = History.get({ sessionId })
    return read({ sessionId })
}

const redo = async ({ sessionId }) => {
    await readMeta(sessionId)
    if (agents.get(sessionId)?.running) throw new Error(`Agent is already running: ${sessionId}`)
    await History.load({ sessionId })
    await History.redo({ sessionId })
    await History.save({ sessionId })
    if (agents.has(sessionId)) agents.get(sessionId).history = History.get({ sessionId })
    return read({ sessionId })
}

const compact = async ({ sessionId, maxTokens, onCompact }) => {
    const meta = await readMeta(sessionId)
    let agent = agents.get(sessionId)
    if (!agent) {
        await History.load({ sessionId })
        await mkdir(Path.tools(), { recursive: true })
        agent = Agent.create({
            id: sessionId,
            history: History.get({ sessionId }),
            config: agentConfig({ providerName: meta.provider, model: meta.model }),
            tools: await Tool.scan(Path.tools()),
            callbacks: { onPermission: Permission.check },
        })
    }
    agents.set(sessionId, agent)
    if (agent.running) throw new Error(`Agent is already running: ${sessionId}`)
    let task
    task = (async () => {
        const context = Context.build({ history: agent.history })
        const result = await Compact.run({
            sessionId,
            messages: context.messages,
            token: context.token,
            maxTokens,
            onCompact,
        })

        // Compact 返回总结消息时，写回 History；未压缩时两者仍是同一个数组。
        if (result.messages !== context.messages) {
            for (const message of result.messages) await History.add({ sessionId, message })
            agent.history.push(...result.messages)
            await History.save({ sessionId })
        }
        return read({ sessionId })
    })()
    agent.running = { task }
    try {
        return await task
    } finally {
        if (agent.running?.task === task) agent.running = null
    }
}

const send = async ({ sessionId, input, ...options }) => {
    const meta = await readMeta(sessionId)
    const agent = agents.get(sessionId) || (await read({ sessionId }), agents.get(sessionId))
    const startLength = options.history ? options.history.length : agent.history.length
    const task = agent.send({
        input,
        ...options,
        config: options.config || agentConfig({ providerName: meta.provider, model: meta.model }),
        callbacks: {
            ...agent.callbacks,
            ...options.callbacks,
            onText: text => SSE.send({ id: sessionId, data: { type: 'text-delta', text } }),
            onRetry: info => SSE.send({ id: sessionId, data: { type: 'retry', ...info } }),
            onToolCall: call => SSE.send({ id: sessionId, data: { ...call, type: 'tool-call' } }),
            onToolOutput: output => SSE.send({ id: sessionId, data: { ...output, type: 'tool-output' } }),
            onToolResult: result => SSE.send({ id: sessionId, data: { ...result, type: 'tool-result' } }),
            onCompact: event => SSE.send({ id: sessionId, data: { type: 'compact', ...event } }),
        },
    })
    task.then(async result => {
        for (const message of agent.history.slice(startLength)) await History.add({ sessionId, message })
        await History.save({ sessionId })
        await SSE.send({ id: sessionId, data: { type: 'finish', ...result } })
    }).catch(() => {})
    return { ok: true }
}

const stop = ({ sessionId }) => agents.get(sessionId)?.stop() || { ok: false }

const decide = ({ sessionId, callId, decision }) => Permission.decide({ sessionId, callId, decision })

export default { create, read, rename, remove, rollback, redo, compact, send, stop, decide }
