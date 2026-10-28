/*
 * 配置指令：读取本机配置、整体保存、试一次模型请求。
 *
 * 配置里有模型服务、按任务的默认模型、MCP、权限、提示词和压缩阈值。
 * 旧版本的 model / uses / compactThreshold 在读取时迁移成新字段，
 * 迁移只改内存里的这一份，下一次保存自然写成新形状。
 *
 * 调用示例：
 *   await Config.read()
 *   Config.get()
 *   await Config.set({ providers: [], permission: { '*': 'ask' } })
 *   await Config.test({ provider: 'local', model: 'qwen3' })
 */

import { fileURLToPath } from 'node:url'
import store from '../store.js'
import Agent from '../features/agent.js'
import Context from '../features/context.js'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'

const packageFile = fileURLToPath(new URL('../package.json', import.meta.url))
let cachedVersion = null

const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

// --- 按任务的默认模型 ---
const MODELS = [
    { task: 'chat', label: '对话', hint: '会话默认使用的模型' },
    { task: 'compact', label: '压缩上下文', hint: '把长对话总结成一段' },
    { task: 'title', label: '生成标题', hint: '给会话起一个短标题' },
    { task: 'task', label: '子任务', hint: '子 agent 干活时用的模型' },
]

// --- 把旧字段迁移成新形状 ---
const migrate = raw => {
    const config = isObject(raw) ? structuredClone(raw) : {}

    // 每个模型的上下文和能力都写在模型对象自己身上。
    for (const provider of Array.isArray(config.providers) ? config.providers : []) {
        if (!isObject(provider)) continue
        const settings = isObject(provider.modelSettings) ? provider.modelSettings : {}
        provider.models = (Array.isArray(provider.models) ? provider.models : []).map(model => {
            if (!isObject(model)) {
                return {
                    id: model,
                    name: model,
                    context: Number(settings[model]?.context) || 128000,
                    capabilities: ['text', 'tools'],
                }
            }
            return {
                ...model,
                context: Number(model.context) || Number(settings[model.id]?.context) || 128000,
                capabilities: Array.isArray(model.capabilities) ? model.capabilities : ['text', 'tools'],
            }
        })
        delete provider.modelSettings
    }

    // 旧版本只有一个全局 model 和一份 uses。
    const models = isObject(config.models) ? config.models : {}
    if (!models.chat && isObject(config.model)) models.chat = { ...config.model }
    for (const [from, to] of [['compact', 'compact'], ['title', 'title'], ['subtask', 'task']]) {
        if (!models[to] && isObject(config.uses?.[from])) models[to] = { ...config.uses[from] }
    }
    config.models = {
        chat: isObject(models.chat) ? { provider: models.chat.provider || '', model: models.chat.model || '' } : { provider: '', model: '' },
        compact: isObject(models.compact) ? { provider: models.compact.provider || '', model: models.compact.model || '' } : { provider: '', model: '' },
        title: isObject(models.title) ? { provider: models.title.provider || '', model: models.title.model || '' } : { provider: '', model: '' },
        task: isObject(models.task) ? { provider: models.task.provider || '', model: models.task.model || '' } : { provider: '', model: '' },
    }
    delete config.model
    delete config.uses

    // 压缩阈值从会话设置搬到全局。
    const compact = isObject(config.compact) ? config.compact : {}
    const value = Number(compact.threshold ?? config.compactThreshold)
    config.compact = { threshold: Number.isFinite(value) && value >= 0.1 && value <= 0.99 ? value : 0.8 }
    delete config.compactThreshold

    if (!isObject(config.mcp)) config.mcp = {}
    if (!isObject(config.permission)) config.permission = {}
    if (!Array.isArray(config.providers)) config.providers = []

    // 这些字段属于已经移除的旧能力，读进来就直接丢掉，不让它们在配置里继续残留。
    delete config.agents
    delete config.snapshot
    delete config.capabilities
    delete config.autoTitle
    delete config.rules
    delete config.diagnostics
    delete config.stream

    // 提示词默认值只填一次；用户明确保存的空字符串保持为空。
    const prompt = isObject(config.prompt) ? config.prompt : {}
    if (prompt.seeded !== true && typeof prompt.system !== 'string') prompt.system = Context.DEFAULT_PROMPT
    if (typeof prompt.system !== 'string') prompt.system = ''
    prompt.seeded = true
    config.prompt = prompt
    return config
}

// --- 读取配置 ---
const read = async (path = Path.config()) => {
    const file = Bun.file(path)
    const raw = await file.exists() ? await file.json() : {}
    const config = migrate(raw)
    Object.keys(store.config).forEach(key => delete store.config[key])
    Object.assign(store.config, config)
    return store.config
}

// --- 整体替换并保存 ---
const set = async newConfig => {
    if (!isObject(newConfig)) throw fail(400, 'config must be an object')
    const config = migrate(newConfig)
    Object.keys(store.config).forEach(key => delete store.config[key])
    Object.assign(store.config, config)
    return Agent.saveConfig()
}

const get = () => store.config

// --- 界面只读元数据：按任务的模型标签 ---
const meta = () => ({ models: MODELS })

// --- 真实试一次模型请求 ---
const test = async ({ provider, model } = {}) => Agent.testModel({ provider, model })

// --- 读取后端版本 ---
const version = async () => {
    cachedVersion ??= (await Bun.file(packageFile).json()).version
    return cachedVersion
}

export default { MODELS, read, set, get, meta, test, version }
