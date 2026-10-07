/*
 * 会话与 Agent 指令：创建会话、读取会话、改标题、删除、回退、压缩、发送消息、停止。
 *
 * 每个会话在磁盘上是一个目录（meta.json + history.json），在内存里对应一台 Agent。
 * 调用示例：
 *   const { sessionId } = await Session.create({ title: '写爬虫' })
 *   await Session.send({ sessionId, input: '帮我写个爬虫' })   // 启动后台任务，过程走 SSE
 *   await Session.stop({ sessionId })
 *   const session = await Session.read({ sessionId })          // { id, title, provider, model, history }
 *   await Session.rollback({ sessionId, messageId })           // 回退到这条消息之前
 *   await Session.redo({ sessionId })
 *   await Session.compact({ sessionId, onCompact: event => {} })
 *   await Session.remove({ sessionId })
 */

import { mkdir, rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import { writeFile } from 'atomically'
import Agent from '@kernel4632/agent-core'
import Config from './config.js' // 读取全局模型配置和权限规则。
import Approval from '../features/approval.js' // 审批工具调用。
import History from '../features/history.js' // 读写当前会话消息。
import Store from '../store.js' // 直接访问会话到 Agent 实例的映射。
import Path from '../utils/path.js' // 生成数据目录路径。
import fail from '../utils/fail.js' // 找不到会话、输入为空等业务错误带上状态码。
import SSE from '../utils/sse.js' // 把运行过程反馈给前端。

// --- 读取会话资料 ---
const readMeta = async sessionId => {
    const file = Bun.file(Path.meta(sessionId))
    // 元数据不存在说明会话不存在，必须反馈 404 语义给调用方。
    if (!await file.exists()) throw fail(404, `Session not found: ${sessionId}`)
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
    if (!provider) throw fail(400, `Provider not found: ${providerName}`)
    let headers = provider.headers || {}
    if (typeof headers === 'string') headers = JSON.parse(headers || '{}') // 设置页把请求头写成 JSON 文本。
    const settings = provider.modelSettings?.[model] || {}
    return {
        baseURL: provider.baseURL || '',
        apiKey: provider.apiKey || provider.key || '',
        model,
        protocol: provider.protocol === 'openai-compatible' ? 'chat' : provider.protocol || 'chat',
        maxTokens: settings.context || settings.contextWindow || 128000, // 上下文预算，到达 80% 时自动压缩
        stream: provider.stream ?? global.stream ?? true,
        system: global.prompt?.system || '',
        provider: { headers, body: provider.body || {} }, // 请求头和额外请求体原样交给底层模型请求
    }
}

// --- 准备用户工具目录 ---
const userTools = async () => {
    const directory = Path.tools()
    await mkdir(directory, { recursive: true }) // 首次启动还没有这个目录，先建出来。
    return directory
}

// --- 创建 Agent 实例 ---
const createAgent = async ({ sessionId, history, meta }) => {
    // 内置工具跟着代码走，用户工具放在数据目录，同名时用户版覆盖内置版。
    const tools = await Agent.tool.scan(new URL('../tools/', import.meta.url), await userTools())
    const agent = Agent.create({
        id: sessionId,
        history,
        config: agentConfig({ providerName: meta.provider, model: meta.model }),
        tools,
        callbacks: { onPermission: Approval.check }, // 工具执行前先过一次权限规则。
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
    if (typeof title !== 'string' || !title.trim()) throw fail(400, 'title must be a non-empty string')
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
    await createAgent({ sessionId: meta.id, history: History.get({ sessionId: meta.id }), meta })
    return { sessionId: meta.id }
}

// --- 读取会话 ---
const read = async ({ sessionId }) => {
    const meta = await readMeta(sessionId)
    const agent = Store.agents.get(sessionId)

    // 运行中的会话以 Agent 手里的历史为准，磁盘上还没有这一轮的新消息。
    if (agent?.running) return { ...meta, history: agent.history }

    await History.load({ sessionId })
    const history = History.get({ sessionId })
    if (agent) agent.history = history // 历史被回退或外部修改过，交回 Agent 手里的必须是最新的。
    else await createAgent({ sessionId, history, meta })
    return { ...meta, history }
}

// --- 重命名会话 ---
const rename = async ({ sessionId, title }) => {
    if (typeof title !== 'string' || !title.trim()) throw fail(400, 'title must be a non-empty string')
    const meta = await readMeta(sessionId)
    meta.title = title.trim()
    meta.updatedAt = Date.now()
    return writeMeta(meta)
}

// --- 删除会话 ---
const remove = async ({ sessionId }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    Store.agents.delete(sessionId)
    await rm(Path.session(sessionId), { recursive: true, force: true })
    return { ok: true }
}

// --- 回退会话历史 ---
const rollback = async ({ sessionId, messageId }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    await History.load({ sessionId })
    await History.rollback({ sessionId, messageId })
    await History.save({ sessionId })
    const agent = Store.agents.get(sessionId)
    if (agent) agent.history = History.get({ sessionId })
    return read({ sessionId })
}

// --- 恢复会话历史 ---
const redo = async ({ sessionId }) => {
    await readMeta(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    await History.load({ sessionId })
    await History.redo({ sessionId })
    await History.save({ sessionId })
    const agent = Store.agents.get(sessionId)
    if (agent) agent.history = History.get({ sessionId })
    return read({ sessionId })
}

// --- 压缩会话历史 ---
const compact = async ({ sessionId }) => {
    const meta = await readMeta(sessionId)
    const agent = await getAgent({ sessionId, meta })
    if (agent.running) throw fail(409, `Agent is already running: ${sessionId}`)

    // 压缩只往历史里追加一条总结，被总结的原文仍然留在磁盘上。
    const startLength = agent.history.length
    const content = await agent.compact({ onCompact: event => SSE.send({ id: sessionId, data: event }) })
    for (const message of agent.history.slice(startLength)) await History.add({ sessionId, message })
    await History.save({ sessionId })
    return { ...await read({ sessionId }), content }
}

// --- 启动 Agent 任务 ---
const send = async ({ sessionId, input }) => {
    // 用户输入在这里检查一次：去掉首尾空格后不能为空。
    if (typeof input !== 'string' || !input.trim()) throw fail(400, 'input must be a non-empty string')
    const meta = await readMeta(sessionId)
    const agent = await getAgent({ sessionId, meta })

    // Agent 运行过程产生的每一段都通过 SSE 推给前端，前端只认事件类型。
    const startLength = agent.history.length
    const task = agent.send({
        input: input.trim(),
        config: agentConfig({ providerName: meta.provider, model: meta.model }),
        callbacks: {
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

    // 任务结束后把这一轮新增的消息写进历史文件，再通知前端刷新。
    task.then(async result => {
        for (const message of agent.history.slice(startLength)) await History.add({ sessionId, message })
        await History.save({ sessionId })
        await SSE.send({ id: sessionId, data: { type: 'agent-finish', ...result } })
    }).catch(error => SSE.send({ id: sessionId, data: { type: 'agent-finish', error: error.message } }))
    return { ok: true }
}

// --- 停止 Agent 任务 ---
const stop = ({ sessionId }) => Store.agents.get(sessionId)?.stop() || { ok: false }

// --- 处理工具审批 ---
const decide = ({ sessionId, toolCallId, decision }) => Approval.decide({ sessionId, toolCallId, decision })

export default { create, read, rename, remove, rollback, redo, compact, send, stop, decide }
