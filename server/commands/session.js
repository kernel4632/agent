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
    onCompact: event => {},      // 压缩过程通知
})
  */

import { mkdir, rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { writeFile } from 'atomically'
import Agent from '@kernel4632/agent-core'
import Config from './config.js' // 读取全局模型配置。
import History from '../features/history.js' // 读写当前会话消息。
import Permission from '../features/permission.js' // 审批工具调用。
import Store from '../store.js' // 直接访问会话到 Agent 实例的映射。
import Path from '../utils/path.js' // 生成数据目录路径。
import SSE from '../utils/sse.js' // 把运行过程反馈给前端。

// --- 读取会话资料 ---
const readMeta = async sessionId => {
    const file = Bun.file(Path.meta(sessionId))
    // 元数据不存在说明会话不存在，必须反馈 404 语义给路由层。
    if (!await file.exists()) throw new Error(`Session not found: ${sessionId}`)
    return file.json()
}

// --- 保存会话资料 ---
const writeMeta = async meta => {
    // 先创建会话目录，再原子写入元数据，避免留下半份 JSON。
    await mkdir(Path.session(meta.id), { recursive: true })
    await writeFile(Path.meta(meta.id), JSON.stringify(meta, null, 2))
    return meta
}

// --- 选择默认模型 ---
const firstModel = () => {
    // 未指定模型时，使用配置中第一个启用的服务商和它的第一个模型。
    const provider = (Config.get().providers || []).find(item => item.enabled !== false)
    const model = provider?.models?.[0]
    return {
        provider: provider?.name || '',
        model: typeof model === 'string' ? model : model?.id || '',
    }
}

// --- 生成 Agent 配置 ---
const agentConfig = ({ providerName, model }) => {
    // Agent 只接收当前会话需要的配置，不直接读取全局配置文件。
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

// --- 创建 Agent 实例 ---
const createAgent = async ({ sessionId, history, meta }) => {
    // 工具目录不存在时自动创建，保证首次启动也能扫描工具。
    await mkdir(Path.tools(), { recursive: true })
    const tools = await Agent.tool.scan(Path.tools())
    const agent = Agent.create({
        id: sessionId,
        history,
        config: agentConfig({ providerName: meta.provider, model: meta.model }),
        tools,
        callbacks: { onPermission: Permission.check },
    })
    Store.agents.set(sessionId, agent)
    return agent
}

// --- 获取或创建 Agent ---
const getAgent = async ({ sessionId, meta }) => {
    const current = Store.agents.get(sessionId)
    if (current) return current
    await History.load({ sessionId })
    return createAgent({ sessionId, history: History.get({ sessionId }), meta })
}

// --- 创建会话 ---
const create = async ({ title, workspaceId, provider, model }) => {
    // 空标题无法帮助用户识别会话，因此在修改任何数据前拒绝请求。
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
    await createAgent({ sessionId: meta.id, history: History.get({ sessionId: meta.id }), meta })
    return { sessionId: meta.id }
}

// --- 读取会话 ---
const read = async ({ sessionId }) => {
    const meta = await readMeta(sessionId)
    const agent = Store.agents.get(sessionId)
    await History.load({ sessionId })
    const history = History.get({ sessionId })
    if (agent?.running) return { ...meta, history: agent.history }
    if (agent && !agent.running) agent.history = history
    if (!agent) await createAgent({ sessionId, history, meta })
    return { ...meta, history }
}

// --- 重命名会话 ---
const rename = async ({ sessionId, title }) => {
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('title must be a non-empty string')
    const meta = await readMeta(sessionId)
    meta.title = title.trim()
    meta.updatedAt = Date.now()
    return writeMeta(meta)
}

// --- 删除会话 ---
const remove = async ({ sessionId }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw new Error(`Agent is already running: ${sessionId}`)
    Store.agents.delete(sessionId)
    await rm(Path.session(sessionId), { recursive: true, force: true })
    return { ok: true }
}

// --- 回退会话历史 ---
const rollback = async ({ sessionId, messageId }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw new Error(`Agent is already running: ${sessionId}`)
    await History.load({ sessionId })
    await History.rollback({ sessionId, messageId })
    await History.save({ sessionId })
    if (Store.agents.get(sessionId)) Store.agents.get(sessionId).history = History.get({ sessionId })
    return read({ sessionId })
}

// --- 恢复会话历史 ---
const redo = async ({ sessionId }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw new Error(`Agent is already running: ${sessionId}`)
    await History.load({ sessionId })
    await History.redo({ sessionId })
    await History.save({ sessionId })
    if (Store.agents.get(sessionId)) Store.agents.get(sessionId).history = History.get({ sessionId })
    return read({ sessionId })
}

// --- 压缩会话历史 ---
const compact = async ({ sessionId, onCompact }) => {
    const meta = await readMeta(sessionId)
    const agent = await getAgent({ sessionId, meta })
    if (agent.running) throw new Error(`Agent is already running: ${sessionId}`)
    const startLength = agent.history.length
    const content = await agent.compact({ onCompact })
    for (const message of agent.history.slice(startLength)) await History.add({ sessionId, message })
    await History.save({ sessionId })
    return { ...await read({ sessionId }), content }
}

// --- 启动 Agent 任务 ---
const send = async ({ sessionId, input, ...options }) => {
    const meta = await readMeta(sessionId)
    const agent = await getAgent({ sessionId, meta })
    const startLength = options.history ? options.history.length : agent.history.length
    const task = agent.send({
        input,
        ...options,
        config: options.config || agentConfig({ providerName: meta.provider, model: meta.model }),
        callbacks: {
            ...agent.callbacks,
            ...options.callbacks,
            onStart: () => SSE.send({ id: sessionId, data: { type: 'agent-start' } }),
            onLLMStart: request => SSE.send({ id: sessionId, data: { type: 'llm-start', ...request } }),
            onLLMFinish: result => SSE.send({ id: sessionId, data: { type: 'llm-finish', ...result } }),
            onLLMEvent: event => SSE.send({ id: sessionId, data: event }),
            onRetry: info => SSE.send({ id: sessionId, data: { type: 'retry', ...info } }),
            onToolCall: call => SSE.send({ id: sessionId, data: { ...call, type: 'tool-call' } }),
            onToolOutput: output => SSE.send({ id: sessionId, data: { ...output, type: 'tool-output' } }),
            onToolResult: result => SSE.send({ id: sessionId, data: { ...result, type: 'tool-result' } }),
            onCompact: event => SSE.send({ id: sessionId, data: event }),
        },
    })
    task.then(async result => {
        for (const message of agent.history.slice(startLength)) await History.add({ sessionId, message })
        await History.save({ sessionId })
        await SSE.send({ id: sessionId, data: { type: 'agent-finish', ...result } })
    }).catch(() => {})
    return { ok: true }
}

// --- 停止 Agent 任务 ---
const stop = ({ sessionId }) => Store.agents.get(sessionId)?.stop() || { ok: false }

// --- 处理工具审批 ---
const decide = ({ sessionId, callId, decision }) => Permission.decide({ sessionId, callId, decision })

export default { create, read, rename, remove, rollback, redo, compact, send, stop, decide }
