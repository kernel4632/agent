/*
 * 全局配置：读磁盘、把旧字段迁移成当前形状、在内存里整体替换、保存回磁盘。
 *
 * 配置里有模型服务、按任务的默认模型、MCP、权限、提示词和压缩阈值。
 * store.config 是内存里的唯一一份；只有本文件写 config.json。
 * 命令层只负责接 HTTP 动作，审批记住规则时也只调用这里的 save。
 *
 * 调用示例：
 *   await Config.read()                                   // 启动时读一次
 *   Config.get()                                          // 拿内存里的那一份
 *   await Config.set({ providers: [], permission: {} })   // 整体替换并落盘
 *   await Config.save()                                   // 把当前内存写回磁盘
 *   Config.meta()                                         // 界面用的按任务模型标签
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import store from '../store.js'
import Context from './context.js'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'

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

// --- 读取配置；测试可以传一个临时路径，不碰用户真实配置 ---
const read = async (path = Path.config()) => {
    const file = Bun.file(path)                              // 指向磁盘上的配置文件
    const raw = await file.exists() ? await file.json() : {} // 第一次运行时还没有文件，按空配置处理
    const config = migrate(raw)                              // 旧版本字段在这里收成当前形状
    Object.keys(store.config).forEach(key => delete store.config[key]) // 先清掉内存里的旧键
    Object.assign(store.config, config)                      // 再把迁移后的配置整份放回去
    return store.config
}

// --- 整体替换并保存 ---
const set = async newConfig => {
    if (!isObject(newConfig)) throw fail(400, 'config must be an object') // 配置只能是一整个对象
    const config = migrate(newConfig)                                  // 用户提交的旧字段也先迁移
    Object.keys(store.config).forEach(key => delete store.config[key]) // 清掉内存里的旧键
    Object.assign(store.config, config)                                // 放进这份新配置
    return save()                                                      // 立刻落盘
}

const get = () => store.config

// --- 界面只读元数据：按任务的模型标签 ---
const meta = () => ({ models: MODELS })

// --- 把内存里的配置写回磁盘；审批记住规则时也用它 ---
const save = async () => {
    const path = Path.config()                                      // 用户数据目录下的 config.json
    await mkdir(dirname(path), { recursive: true })                 // 第一次保存时目录可能还不存在
    await writeFile(path, JSON.stringify(store.config, null, 2))    // 原子写入，避免中途留下半份 JSON
    return store.config
}

export default { MODELS, read, set, get, meta, save }
