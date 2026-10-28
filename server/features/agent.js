/*
 * 会话的 Agent：准备模型连接、系统提示词、工具表，并缓存运行中的实例。
 *
 * 模型请求和循环由 @kernel4632/agent-core 负责；这里只回答四件事：
 * 用哪个模型、带哪段提示词、给哪些工具、这次会话的权限和设置。
 * 默认模型按任务分开：对话、压缩、标题、子任务各用 config.models 里那一个。
 *
 * 调用示例：
 *   const agent = await Agent.get({ sessionId })
 *   const settings = await Agent.readSettings(sessionId)
 *   await Agent.saveSettings({ sessionId, agent: 'plan' })
 *   const config = Agent.resolve({ session })
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import AgentCore from '@kernel4632/agent-core'
import store from '../store.js'
import Context from './context.js'
import History from './history.js'
import Tool from './tool.js'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'

// 名字会写进会话设置和规则目录名，只收安全字符。
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/
const ACTIONS = new Set(['allow', 'ask', 'deny'])

// 内置智能体；用户可以同名覆盖，也可以新增。
const BUILTIN = [
    {
        name: 'build', label: '执行', description: '可以改文件、执行命令', instructions: '',
        readOnly: false, tools: null, model: null, permission: null,
    },
    {
        name: 'plan', label: '计划', description: '只读工具，先看清再动手', instructions: '',
        readOnly: true, tools: null, model: null, permission: null,
    },
    {
        name: 'ask', label: '问答', description: '只回答和解释，不碰文件',
        instructions: '你只回答问题和解释代码，不修改文件。回答要直接，必要时指出相关文件路径。',
        readOnly: true,
        tools: ['read_file', 'list_files', 'search_files', 'glob', 'webfetch', 'skill', 'ask_followup_question', 'attempt_completion'],
        model: null, permission: null,
    },
    {
        name: 'debug', label: '调试', description: '复现、定位、最小修复',
        instructions: '先复现问题，再定位原因，最后做最小修复。改完运行相关测试，并把结果说清楚。',
        readOnly: false, tools: null, model: null, permission: null,
    },
]

// 运行中的 Agent 实例：不能写进 store，也不能序列化。
const agents = new Map()

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const cleanText = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback

// --- 只保留合法的工具名；null 表示不点名 ---
const normalizeTools = value => {
    if (!Array.isArray(value)) return null
    return [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))]
}

// --- 模型覆盖只认同时写了供应商和模型名的对象 ---
const normalizeModel = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const provider = cleanText(value.provider)
    const model = cleanText(value.model)
    return provider && model ? { provider, model } : null
}

// --- 权限覆盖和全局 permission 同形 ---
const normalizePermission = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const rules = {}
    for (const [name, rule] of Object.entries(value)) {
        if (typeof rule === 'string') {
            if (ACTIONS.has(rule)) rules[name] = rule
            continue
        }
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue
        const nested = {}
        for (const [pattern, action] of Object.entries(rule)) {
            if (typeof action === 'string' && ACTIONS.has(action)) nested[pattern] = action
        }
        if (Object.keys(nested).length) rules[name] = nested
    }
    return Object.keys(rules).length ? rules : null
}

// --- 把一条自定义定义叠到基础定义上 ---
const merge = (value, base) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base
    return {
        ...base,
        label: cleanText(value.label, base.label) || base.label,
        description: cleanText(value.description, base.description),
        instructions: typeof value.instructions === 'string' ? value.instructions : base.instructions,
        readOnly: typeof value.readOnly === 'boolean' ? value.readOnly : base.readOnly,
        tools: has(value, 'tools') ? normalizeTools(value.tools) : base.tools,
        model: has(value, 'model') ? normalizeModel(value.model) : base.model,
        permission: has(value, 'permission') ? normalizePermission(value.permission) : base.permission,
    }
}

const definitions = config => {
    const value = config?.agents
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// --- 当前可用的全部智能体 ---
const list = (config = store.config) => {
    const custom = definitions(config)
    const result = BUILTIN.map(base => ({ ...merge(custom[base.name], base), name: base.name, builtin: true }))
    for (const [name, value] of Object.entries(custom)) {
        if (!SAFE_NAME.test(name)) continue
        if (BUILTIN.some(base => base.name === name)) continue
        result.push({
            ...merge(value, { label: name, description: '', instructions: '', readOnly: false, tools: null, model: null, permission: null }),
            name,
            builtin: false,
        })
    }
    return result
}

// --- 按名字取一个智能体 ---
const get = (config, name) => list(config).find(item => item.name === name) || null

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

const resolveFor = ({ session, settings, agent, target }) => {
    const chosen = target || session.model
    const linked = connection(chosen)
    const info = Context.modelInfo(chosen)
    const profile = info.capabilities || []

    const config = {
        ...linked,
        provider: {
            ...linked.provider,
            body: reasoningBody({ protocol: linked.protocol, level: settings.reasoning, source: linked.provider.body }),
        },
        maxContextTokens: info.context,
        compactThreshold: threshold(),
        stream: settings.capabilities.stream,
        cache: settings.capabilities.cache,
        capabilities: {
            image: settings.capabilities.image && (profile.length === 0 || hasCapability(profile, 'image')),
            tools: profile.length === 0 || hasCapability(profile, 'tools'),
        },
        system: Context.system({ config: store.config, agent }),
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

// --- 把当前配置写回磁盘；审批记住规则时也用它 ---
const saveConfig = async () => {
    const path = Path.config()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(store.config, null, 2))
    return store.config
}

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
    agent: 'build',
    autoApprove: autoApproveDefaults(),
    autoApproveLimit: 50,
    capabilities: { image: true, cache: true, stream: true },
    reasoning: 'auto',
})

// --- 智能体：旧版本叫 mode ---
const chooseAgent = (input, base) => {
    const requested = input.agent !== undefined ? input.agent : input.mode
    const chosen = requested !== undefined ? requested : base.agent
    if (!get(store.config, chosen)) {
        throw fail(400, `agent must be one of ${list().map(item => item.name).join(', ')}, got: ${requested ?? input.agent}`)
    }
    return chosen
}

// --- 自动批准：按类别合并；旧的布尔总开关摊到每一类 ---
const mergeAutoApprove = (input, base) => {
    const source = typeof input.autoApprove === 'boolean'
        ? Object.fromEntries(Tool.KINDS.map(item => [item.kind, input.autoApprove]))
        : (input.autoApprove || {})
    const autoApprove = {}
    for (const item of Tool.KINDS) autoApprove[item.kind] = (source[item.kind] ?? base.autoApprove[item.kind]) === true
    return autoApprove
}

const numberWithin = (value, min, max, fallback) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

// --- 收一份用户提交的设置，坏值保持原样或忽略 ---
const normalizeSettings = (input = {}, base = defaultSettings()) => {
    const capabilities = { ...base.capabilities, ...(input.capabilities || {}) }
    const parsedLimit = Number(input.autoApproveLimit === undefined ? base.autoApproveLimit : input.autoApproveLimit)
    const rawReasoning = input.reasoning === undefined ? base.reasoning : input.reasoning
    return {
        agent: chooseAgent(input, base),
        autoApprove: mergeAutoApprove(input, base),
        autoApproveLimit: Number.isInteger(parsedLimit) && parsedLimit >= 0 ? parsedLimit : base.autoApproveLimit,
        capabilities: {
            image: capabilities.image !== false,
            cache: capabilities.cache !== false,
            stream: capabilities.stream !== false,
        },
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
 * 换智能体要重建 Agent，所以任务跑着时拒绝；自动批准不用重建，随时能改。
 */
const saveSettings = async ({ sessionId, ...change }) => {
    const session = await History.load(sessionId)
    const current = normalizeSettings(session.settings, defaultSettings())
    const onlyAutoApprove = Object.keys(change).every(key => key === 'autoApprove')
    if (!onlyAutoApprove && agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    const requested = change.agent !== undefined ? change.agent : change.mode
    const requestedInfo = requested !== undefined ? get(store.config, requested) : null
    if (requestedInfo?.model) connection(requestedInfo.model)

    const saved = normalizeSettings(change, current)
    await History.saveSettings({ sessionId, settings: saved })

    // 智能体自带模型时，把会话当前模型切过去；切到不带模型的智能体时保留原模型。
    if (saved.agent !== current.agent) {
        const agent = get(store.config, saved.agent)
        if (agent?.model) {
            session.model = { provider: agent.model.provider, model: agent.model.model }
            session.updatedAt = Date.now()
            await History.save(sessionId)
        }
    }
    if (onlyAutoApprove) return saved

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
    const session = await History.load(sessionId)
    const settings = await readSettings(sessionId)
    const agent = get(store.config, settings.agent)
    const config = resolveFor({ session, settings, agent })
    const tools = await Tool.build({
        sessionId,
        agent,
        // 子任务可以用 models.task 单独指定；没配就沿用会话当前模型。
        taskConfig: resolveFor({ session, settings, agent, target: configured(store.config.models?.task) || session.model }),
    })
    // 动态导入避开工具装配时的加载环；审批只在工具真正执行时才会用到。
    const { default: Approval } = await import('./approval.js')
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
    BUILTIN,
    list, find: get,
    defaultSettings, normalizeSettings, readSettings, saveSettings,
    connection, configured, firstModel, defaultModel, taskModel, resolve: resolveFor, testModel, saveConfig,
    create, get: getAgent, runtime, runningCount, invalidate,
    REASONING_LEVELS, threshold,
}
