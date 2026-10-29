/*
 * 会话的 Agent：准备模型连接、系统提示词、工具表，并缓存运行中的实例。
 *
 * 主 Agent 只有一个通用运行角色：使用全部工具，不按会话切换身份。
 * 模型请求和循环由 @kernel4632/agent-core 负责；这里只回答四件事：
 * 用哪个模型、带哪段提示词、给哪些工具、这次会话的权限和设置。
 * 默认模型按任务分开：对话、压缩、标题、子任务各用 config.models 里那一个。
 * 工具需要的审批和保存会话能力，在装配时从这里传进 Tool.build；工具不反向 import features。
 *
 * 调用示例：
 *   const agent = await Agent.get({ sessionId })
 *   const settings = await Agent.readSettings(sessionId)
 *   await Agent.saveSettings({ sessionId, reasoning: 'high' })
 *   const config = Agent.resolve({ session })
 */

import AgentCore from '@kernel4632/agent-core'
import store from '../store.js'
import Approval from './approval.js'
import Context from './context.js'
import History from './history.js'
import Tool from './tool.js'
import fail from '../utils/fail.js'

// 运行中的 Agent 实例：不能写进 store，也不能序列化。
const agents = new Map()

// =======================================================================
//  模型连接
// =======================================================================

// 思考强度：和界面滑块顺序一致。
const REASONING_LEVELS = ['off', 'auto', 'low', 'medium', 'high', 'xhigh', 'max']
const REASONING_EFFORT = { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
const REASONING_BUDGET = { low: 1000, medium: 2000, high: 8000, xhigh: 16000, max: 32000 }

// --- 把思考强度翻成各家请求体能认的字段 ---
const reasoningBody = ({ protocol, level, source }) => {
    const body = source && typeof source === 'object' && !Array.isArray(source) ? structuredClone(source) : {}
    if (!level || level === 'auto') return body
    if (protocol === 'anthropic') {
        body.thinking = level === 'off' ? { type: 'disabled' } : { type: 'adaptive', display: 'summarized' }
        if (level !== 'off') body.output_config = { ...(body.output_config || {}), effort: REASONING_EFFORT[level] }
        return body
    }
    if (protocol === 'gemini') {
        body.generationConfig = {
            ...(body.generationConfig || {}),
            thinkingConfig: level === 'off'
                ? { thinkingBudget: 0, includeThoughts: false }
                : { thinkingBudget: REASONING_BUDGET[level], includeThoughts: true },
        }
        return body
    }
    if (protocol === 'responses') {
        body.reasoning = { ...(body.reasoning || {}), effort: REASONING_EFFORT[level] }
        return body
    }
    body.reasoning_effort = REASONING_EFFORT[level]
    return body
}

/**
 * 怎么连上某个模型：地址、密钥、协议、请求头。
 * @param {{ provider?: string, model?: string }} target 哪个供应商的哪个模型。
 * @returns {object} 交给 agent-core / Agent.llm.chat 的连接字段。
 */
const connection = ({ provider: name, model }) => {
    const provider = (store.config.providers || []).find(item => item.name === name)
    if (!provider) throw fail(400, `Provider not found: ${name}`)

    let headers = provider.headers || {}
    if (typeof headers === 'string') {
        try {
            headers = JSON.parse(headers || '{}')
        } catch {
            throw fail(400, 'provider headers must be valid JSON')
        }
    }
    return {
        model,
        baseURL: provider.baseURL || '',
        apiKey: provider.apiKey || provider.key || '',
        protocol: provider.protocol === 'openai-compatible' ? 'chat' : provider.protocol || 'chat',
        provider: { headers, body: provider.body || {} },
    }
}

// --- 配置里写全了、而且供应商真的存在时才算可用 ---
const configured = target => {
    if (!target?.provider || !target?.model) return null
    const provider = (store.config.providers || []).find(item => item.name === target.provider && item.enabled !== false)
    return provider ? { provider: provider.name, model: target.model } : null
}

// --- 某件事默认用哪个模型：先看 models 里那一项，再回退到对话模型 ---
const taskModel = task => {
    const chosen = configured(store.config.models?.[task])
    if (chosen) return chosen
    const chat = configured(store.config.models?.chat)
    if (chat) return chat
    return firstModel()
}

// --- 配置里第一个能用的模型 ---
const firstModel = () => {
    const provider = (store.config.providers || []).find(item => item.enabled !== false)
    const model = provider?.models?.[0]
    return {
        provider: provider?.name || '',
        model: typeof model === 'string' ? model : model?.id || '',
    }
}

// --- 新会话默认用 models.chat；没配或配置失效时回退到第一个模型 ---
const defaultModel = () => configured(store.config.models?.chat) || firstModel()

// --- 把配置翻成 agent-core 认的字段 ---
const hasCapability = (profile, name) => profile.some(item => {
    const value = String(item).toLowerCase()
    if (value === name) return true
    // 旧配置和界面用中文标签，认出来才不会把工具能力关掉。
    if (name === 'text') return value === '文本'
    if (name === 'tools') return value === '工具'
    if (name === 'image') return value === '图片'
    return false
})

const resolveFor = ({ session, settings, target }) => {
    const chosen = target || session.model
    const linked = connection(chosen)
    const info = Context.modelInfo(chosen)
    const profile = info.capabilities || []
    const provider = (store.config.providers || []).find(item => item.name === chosen.provider)

    const config = {
        ...linked,
        provider: {
            ...linked.provider,
            body: reasoningBody({ protocol: linked.protocol, level: settings.reasoning, source: linked.provider.body }),
        },
        maxContextTokens: info.context,
        compactThreshold: threshold(),
        // 流式输出是连接配置，不是模型能力；模型能力只从 capabilities 读。
        stream: provider?.stream !== false,
        cache: true,
        capabilities: {
            image: hasCapability(profile, 'image'),
            tools: hasCapability(profile, 'tools'),
        },
        system: Context.system({ config: store.config }),
        // 一轮没有工具调用就结束；默认提示词要求用 attempt_completion 收尾。
        noToolRounds: 1,
    }

    // 压缩可以另换一个模型，只换连接那一半；上下文预算仍按主模型算。
    const compact = configured(store.config.models?.compact)
    if (compact) config.compact = connection(compact)
    return config
}

// --- 压缩阈值只收 0.1 到 0.99 ---
const threshold = () => {
    const value = Number(store.config.compact?.threshold)
    return Number.isFinite(value) && value >= 0.1 && value <= 0.99 ? value : 0.8
}

// --- 真实试一次模型请求 ---
const testModel = async ({ provider: name, model }) => {
    if (name) {
        const provider = (store.config.providers || []).find(item => item.name === name)
        if (!provider) throw fail(400, `Provider not found: ${name}`)
        const first = provider.models?.[0]
        const chosen = model || (typeof first === 'string' ? first : first?.id)
        if (!chosen) throw fail(400, `Provider has no model to test: ${name}`)
        return attempt({ provider: name, model: chosen })
    }
    const chosen = firstModel()
    if (!chosen.provider || !chosen.model) throw fail(400, 'no provider or model configured to test')
    return attempt(chosen)
}

// --- 试一次真实请求 ---
const attempt = async chosen => {
    const result = await AgentCore.llm.chat({
        ...resolveFor({ session: { model: chosen }, settings: defaultSettings() }),
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
    })
    return { ok: true, provider: chosen.provider, model: chosen.model, text: result.text }
}

// =======================================================================
//  会话设置
// =======================================================================

const autoApproveDefaults = () => Object.fromEntries(Tool.KINDS.map(item => [item.kind, false]))

const defaultSettings = () => ({
    autoApprove: autoApproveDefaults(),
    autoApproveLimit: 50,
    reasoning: 'auto',
})

// --- 自动批准：按类别合并；旧的布尔总开关摊到每一类 ---
const mergeAutoApprove = (input, base) => {
    const source = typeof input.autoApprove === 'boolean'
        ? Object.fromEntries(Tool.KINDS.map(item => [item.kind, input.autoApprove]))
        : (input.autoApprove || {})
    const autoApprove = {}
    for (const item of Tool.KINDS) autoApprove[item.kind] = (source[item.kind] ?? base.autoApprove[item.kind]) === true
    return autoApprove
}

// --- 收一份用户提交的设置，坏值保持原样或忽略 ---
const normalizeSettings = (input = {}, base = defaultSettings()) => {
    const parsedLimit = Number(input.autoApproveLimit === undefined ? base.autoApproveLimit : input.autoApproveLimit)
    const rawReasoning = input.reasoning === undefined ? base.reasoning : input.reasoning
    return {
        autoApprove: mergeAutoApprove(input, base),
        autoApproveLimit: Number.isInteger(parsedLimit) && parsedLimit >= 0 ? parsedLimit : base.autoApproveLimit,
        reasoning: REASONING_LEVELS.includes(rawReasoning) ? rawReasoning : base.reasoning,
    }
}

// --- 读设置；没存过时给默认值 ---
const readSettings = async sessionId => {
    const session = await History.load(sessionId)
    return normalizeSettings(session.settings, defaultSettings())
}

/**
 * 改设置，只改点名的那几项。
 * 思考强度要重建 Agent；自动批准和上限不用，随时能改。
 */
const saveSettings = async ({ sessionId, ...change }) => {
    const current = normalizeSettings((await History.load(sessionId)).settings, defaultSettings())
    const saved = normalizeSettings(change, current)

    if (change.reasoning !== undefined && change.reasoning !== current.reasoning && agents.get(sessionId)?.running) {
        throw fail(409, `Agent is already running: ${sessionId}`)
    }
    await History.saveSettings({ sessionId, settings: saved })
    if (change.reasoning === undefined || change.reasoning === current.reasoning) return saved

    // 历史原样交回去，不丢消息。
    agents.delete(sessionId)
    await create({ sessionId })
    return saved
}

// =======================================================================
//  装配 Agent
// =======================================================================

// --- 为一个会话建出 Agent 实例 ---
const create = async ({ sessionId }) => {
    const session = await History.load(sessionId)                     // 先把会话元数据读进内存
    const settings = await readSettings(sessionId)                    // 这条会话自己的思考强度和自动批准
    const config = resolveFor({ session, settings })                  // 把配置翻成 agent-core 认的连接字段
    const tools = await Tool.build({
        sessionId,
        // 子任务可以用 models.task 单独指定；没配就沿用会话当前模型。
        taskConfig: resolveFor({ session, settings, target: configured(store.config.models?.task) || session.model }),
        onPermission: Approval.check,                                 // 工具执行前回到同一个审批关口
        saveSession: () => History.save(sessionId),                   // 工具改了会话（比如 cwd）后能立刻落盘
    })
    // 审批只依赖 config 和工具宿主，不再 import agent；这里静态引入不会成环。
    const instance = AgentCore.create({
        id: sessionId,
        history: session.history.messages.map(record => record.message),
        config,
        tools,
        callbacks: { onPermission: Approval.check },
    })
    // 记下装配时的目录：cwd 工具移动之后，下一次运行要按新目录重建工具表。
    instance.cwd = session.cwd
    agents.set(sessionId, instance)
    return instance
}

// --- 获取或创建 Agent ---
const getAgent = async ({ sessionId }) => {
    const session = await History.load(sessionId)
    const current = agents.get(sessionId)
    if (current) {
        if (!current.running && current.cwd !== undefined && current.cwd !== session.cwd) {
            agents.delete(sessionId)
            return create({ sessionId })
        }
        // 空闲时补上别的入口刚追加的消息；回退后变短的历史由 Session.read 负责交回。
        if (!current.running) {
            const stored = History.get({ sessionId })
            if (stored.length > current.history.length) current.history = stored
        }
        return current
    }
    return create({ sessionId })
}

// --- 运行中的 Agent 实例只给运行模块用 ---
const runtime = () => agents

// --- 正在跑的会话数量 ---
const runningCount = () => [...agents.values()].filter(agent => agent.running).length

// --- 供应商/模型切换后重建 ---
const invalidate = sessionId => agents.delete(sessionId)

export default {
    defaultSettings, normalizeSettings, readSettings, saveSettings,
    connection, configured, firstModel, defaultModel, taskModel, resolve: resolveFor, testModel,
    create, get: getAgent, runtime, runningCount, invalidate,
    REASONING_LEVELS, threshold,
}
