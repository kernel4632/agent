/*
 * 会话的 Agent：准备模型连接、系统提示词、工具表，并缓存运行中的实例。
 *
 * 主 Agent 只有一个通用运行角色：使用全部工具，不按会话切换身份。
 * 模型请求和循环由 @kernel4632/agent-core 负责；这里只回答四件事：
 * 用哪个模型、带哪段提示词、给哪些工具、这次会话的权限和设置。
 * 默认模型按任务分开：对话、压缩、标题、子任务各用 config.models 里那一个；
 * 没配的那几项跟会话自己的模型走，压缩交给 core 用主连接。
 * 审批、工具、历史和上下文由命令层在启动时 bind；本文件不 import 任何 feature。
 *
 * agent-core 的消费点目前有三处，各自只取需要的那块能力：
 *   agent.js  create()          会话装配：历史 + 工具表 + 审批回调的完整循环
 *   title.js  llm.chat()        一次性的单发请求（起标题），不走会话装配
 *   tool.js   tool.adopt()      把本仓库的工具对象适配成 core 认识的工具表
 * 新增 core 能力时先看这里能不能长出来，不要随手多一个直接消费点。
 *
 * 调用示例：
 *   Agent.bind({ history, tool, approval, context })   // 命令层启动时注入
 *   const agent = await Agent.get({ sessionId })
 *   const settings = await Agent.readSettings(sessionId)
 *   await Agent.saveSettings({ sessionId, reasoning: 'high' })
 *   const config = await Agent.resolve({ session })
 */

import AgentCore from '@kernel4632/agent-core'
import store from '../store.js'
import fail from '../utils/fail.js'
import ContextRatios from '../utils/context-ratios.js'

// 运行中的 Agent 实例：不能写进 store，也不能序列化。
const agents = new Map()

// 命令层在启动时注入 history/tool/approval/context；本文件不 import 任何 feature。
let services = {}
const bind = value => { services = value }

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
        apiKey: provider.apiKey || '',
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

// --- 某件事用哪个模型：先看 models 里那一项，再退到调用方给的连接（会话自己的模型），最后退到第一个可用模型 ---
// 标题和压缩各自可以另配模型；子任务模型（models.task）等子智能体功能恢复时再接上消费。
const taskModel = (task, fallback) => configured(store.config.models?.[task]) || configured(fallback) || defaultModel()
const firstModel = () => {
    const provider = (store.config.providers || []).find(item => item.enabled !== false)
    const model = provider?.models?.[0]
    return {
        provider: provider?.name || '',
        model: model?.id || '',
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
    if (name === 'reasoning') return value === '推理'
    if (name === 'reasoning-replay') return value === '回传思考'
    return false
})

// --- 恢复续跑的尝试上限 ---
// 恢复是后台自动行为，没人看着：provider 挂了、密钥过期、地址错了，无限重试会一直烧下去，
// 而且任务永远不结束、运行标记永远不清，下次重启又续一次。给恢复路径一个总时限和次数上限，
// 到点就把错误交给 finishFailure（发 agent-finish.error 并清标记），用户自己发的消息不受影响。
const RECOVERY_RETRY_ELAPSED = 120000
const RECOVERY_RETRY_TRIES = 3
// 400/401/403 这类请求错误重试也不会变好，尤其历史协议/字段缺失会无限重试；
// 这类错误只展示一次，交给用户或上层修复配置/历史。
const noRetryClientErrors = error => {
    if (error?.kind === 'request' || error?.kind === 'auth') return false
    const status = Number(error?.statusCode || 0)
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false
    return true
}
// core 的 retry 可以传一个“要不要重试这个错误”的过滤函数；这里按次数收口。
const recoveryRetry = () => {
    let tries = 0
    return error => {
        tries += 1
        return tries < RECOVERY_RETRY_TRIES
    }
}

const resolveFor = async ({ session, settings, target, recovery = false }) => {
    const chosen = target || session.model
    const linked = connection(chosen)
    const info = services.context.modelInfo(chosen)
    const profile = info.capabilities || []
    const provider = (store.config.providers || []).find(item => item.name === chosen.provider)
    const profileModel = provider?.models?.find(item => item.id === chosen.model)
    const generation = {}
    for (const field of ['temperature', 'topP', 'seed']) {
        if (profileModel?.[field] !== undefined) generation[field] = profileModel[field]
    }

    const config = {
        ...linked,
        // 记录来源名字；core 的连接字段只有 provider 对象，统计面板需要可读的供应商名。
        providerName: chosen.provider,
        provider: {
            ...linked.provider,
            ...generation,
            body: {
                ...reasoningBody({ protocol: linked.protocol, level: settings.reasoning, source: linked.provider.body }),
                ...(profileModel?.body || {}),
            },
        },
        maxContextTokens: info.context,
        maxTokens: profileModel?.maxOutput,
        compactThreshold: threshold(),
        // 流式输出是连接配置，不是模型能力；模型能力只从 capabilities 读。
        stream: provider?.stream !== false,
        cache: true,
        capabilities: {
            image: hasCapability(profile, 'image'),
            tools: hasCapability(profile, 'tools'),
            // 推理输出和“把推理回传”是两件事：前者是展示，后者是协议兼容。
            // 只有模型声明 reasoning-replay 才回传，避免有推理但不接受回传的模型被 400。
            reasoning: hasCapability(profile, 'reasoning-replay'),
        },
        // 图片随历史常驻：没开 image 能力的模型每次请求前由 core 剔除图片块，开了的照常发送。
        mediaFallback: 'strip',
        // 重试由 agent-core 统一处理：无限次数、5s 起指数退避、总时长不限。
        // 这里只把单次退避上限从 core 0.30.2 的默认 10 分钟收紧到 120s，其余全用 core 默认。
        retryMaxDelay: 120000,
        // 恢复续跑必须封顶：provider 挂了或配置丢失时，无限重试会变成一个永不结束、
        // 永不清运行标记的空转任务，每次重启又续一次。只对恢复路径设总时限和次数上限，
        // 用户自己发的消息仍用 core 默认的无限重试，不因慢供应商而失败。
        ...(recovery ? { retryMaxElapsed: RECOVERY_RETRY_ELAPSED, retry: recoveryRetry } : { retry: noRetryClientErrors }),
        // 压缩后保留多少总结之前的原文；四个值都由 config 层补默认值，core 也认同名配置。
        // firstTurns = 0 就是不要最初那几轮原始措辞，只信总结 + 最近现场。
        contextKeep: { ...store.config.contextKeep },
        // 完整 system = 用户提示词 + 当前目录的项目规则（AGENTS.md）+ 压缩输出规范。
        system: await services.context.systemFor({ config: store.config, cwd: session?.cwd }),
        // 连续 3 轮没调用任何工具才结束；默认提示词要求用 attempt_completion 收尾，
        // 中间会插一条提醒，避免模型漏调结束工具就直接把文字当成结果（参考 Roo Code 的连续错误上限）。
        noToolRounds: 3,
        noToolPrompt: '[Error] Your last response did not call any tool. Continue the task. Finish by calling attempt_completion with the complete reply in result, or ask_followup_question if you are blocked. Do not answer in plain text.',
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
        const chosen = model || first?.id
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
        ...await resolveFor({ session: { model: chosen }, settings: defaultSettings() }),
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
    })
    return { ok: true, provider: chosen.provider, model: chosen.model, text: result.text }
}

// =======================================================================
//  会话设置
// =======================================================================

const defaultSettings = () => ({
    reasoning: 'auto',
})

// --- 收一份用户提交的设置，坏值保持原样或忽略 ---
const normalizeSettings = (input = {}, base = defaultSettings()) => {
    const rawReasoning = input.reasoning === undefined ? base.reasoning : input.reasoning
    return {
        reasoning: REASONING_LEVELS.includes(rawReasoning) ? rawReasoning : base.reasoning,
    }
}

// --- 读设置；没存过时给默认值 ---
const readSettings = async sessionId => {
    const session = await services.history.load(sessionId)
    return normalizeSettings(session.settings, defaultSettings())
}

/**
 * 改设置，只改点名的那几项。
 * 运行中改思考强度直接更新活 Agent 的 config，下一笔请求生效，不打断当前运行。
 */
const saveSettings = async ({ sessionId, ...change }) => {
    const current = normalizeSettings((await services.history.load(sessionId)).settings, defaultSettings())
    const saved = normalizeSettings(change, current)

    await services.history.saveSettings({ sessionId, settings: saved })
    if (change.reasoning === undefined || change.reasoning === current.reasoning) return saved

    const agent = agents.get(sessionId)
    if (agent?.running) {
        // core 0.30 每轮重新读 agent.config；正在跑的请求不打断，下一轮换新强度。
        const session = await services.history.load(sessionId)
        Object.assign(agent.config, await resolveFor({ session, settings: saved }))
        return saved
    }

    // 历史原样交回去，不丢消息。
    agents.delete(sessionId)
    await create({ sessionId })
    return saved
}

// =======================================================================
//  装配 Agent
// =======================================================================

// --- 把最新的 system（含项目规则）刷进一个已建好的 Agent ---
const refreshSystem = async (instance, session) => {
    // 测试注入的假实例没有 config；没有就不刷，下次真装配时自然会读到规则。
    if (!instance?.config) return
    instance.config.system = await services.context.systemFor({ config: store.config, cwd: session.cwd })
}

// --- 为一个会话建出 Agent 实例 ---
const create = async ({ sessionId }) => {
    const session = await services.history.load(sessionId)                     // 先把会话元数据读进内存
    const settings = await readSettings(sessionId)                    // 这条会话自己的思考强度
    const config = await resolveFor({ session, settings })                  // 把配置翻成 agent-core 认的连接字段
    // 上一次进程从真实 usage 学到的字符/token 比例；core 冷启动没有它，
    // 第一次估算会退回 0.6，长历史容易误压。按 provider + model 取回。
    const rememberedRatio = await ContextRatios.read({ provider: config.providerName, model: config.model })
    if (rememberedRatio) config.contextRatio = rememberedRatio.ratio
    const built = await services.tool.build({
        sessionId,
        onPermission: services.approval.check,                                 // 工具执行前回到同一个审批关口
        saveSession: () => services.history.save(sessionId),                   // 工具改了会话（比如 cwd）后能立刻落盘
    })
    // Tool.build 返回工具快照和 MCP 租约；兼容旧的纯数组返回值。
    const tools = Array.isArray(built) ? built : built.tools
    let instance
    try {
        // 审批只依赖 config 和工具宿主，不再 import agent；这里静态引入不会成环。
        instance = AgentCore.create({
            id: sessionId,
            history: session.history.messages.map(record => record.message),
            config,
            tools,
            callbacks: { onPermission: services.approval.check },
        })
        // 记下装配时的目录：cwd 工具移动之后，下一次运行要按新目录重建工具表。
        instance.cwd = session.cwd
        instance.mcpRevision = Array.isArray(built) ? 0 : built.mcpRevision
        instance.releaseTools = Array.isArray(built) ? null : built.release
        await refreshSystem(instance, session)                   // 项目规则按装配那一刻的目录读一次
    } catch (error) {
        await Promise.resolve(built?.release?.()).catch(() => {})
        throw error
    }
    agents.set(sessionId, instance)
    return instance
}

// --- 丢掉一个 Agent 时一并释放它持有的 MCP 连接 ---
const dispose = async instance => {
    const release = instance?.releaseTools
    if (!release) return
    instance.releaseTools = null
    await Promise.resolve(release()).catch(() => {})
}

// --- 获取或创建 Agent ---
const getAgent = async ({ sessionId }) => {
    const session = await services.history.load(sessionId)
    const current = agents.get(sessionId)
    const revision = services.tool.mcpRevision?.() || 0
    if (current) {
        // 配置变化时只让空闲 Agent 重建；运行中的回合继续用旧快照，结束再收敛。
        const stale = Number.isFinite(current.mcpRevision) && current.mcpRevision !== revision
        if (stale && current.running) {
            current.stale = true
            await refreshSystem(current, session)
            return current
        }
        if (stale) {
            agents.delete(sessionId)
            await dispose(current)
            return create({ sessionId })
        }
        if (!current.running && current.cwd !== undefined && current.cwd !== session.cwd) {
            agents.delete(sessionId)
            await dispose(current)
            return create({ sessionId })
        }
        // 空闲时补上别的入口刚追加的消息；回退后变短的历史由 Session.read 负责交回。
        if (!current.running) {
            const stored = services.history.get({ sessionId })
            if (stored.length > current.history.length) current.history = stored
        }
        // 项目规则可能刚被改过；每次取实例都刷一次 system，缓存的旧内容不会带过下一轮。
        await refreshSystem(current, session)
        return current
    }
    return create({ sessionId })
}

// --- 回合结束后回收已经过期的 Agent，避免旧 MCP 连接一直挂着 ---
const settle = async sessionId => {
    const current = agents.get(sessionId)
    if (!current || current.running) return
    const revision = services.tool.mcpRevision?.() || 0
    if (!Number.isFinite(current.mcpRevision) || current.mcpRevision === revision) return
    agents.delete(sessionId)
    await dispose(current)
}

// --- 运行中的 Agent 实例只给运行模块用 ---
const runtime = () => agents

// --- 正在跑的会话数量 ---
const runningCount = () => [...agents.values()].filter(agent => agent.running).length

// --- 供应商/模型切换后重建 ---
const invalidate = sessionId => {
    const current = agents.get(sessionId)
    agents.delete(sessionId)
    void dispose(current)
}

export default {
    defaultSettings, normalizeSettings, readSettings, saveSettings,
    connection, configured, firstModel, defaultModel, taskModel, resolve: resolveFor, testModel,
    create, get: getAgent, runtime, runningCount, invalidate, settle, bind,
    REASONING_LEVELS, threshold,
}
