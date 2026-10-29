/*
 * 全局配置：读取当前形状、补默认值、整体替换、保存回磁盘。
 *
 * 只认最新版本的形状，不迁移旧字段。每个模型自己带上下文长度和能力；
 * store.config 是内存里的唯一一份，只有本文件写 config.json。
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
import store, { DEFAULT_PROMPT } from '../store.js'
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

// --- 一个模型必须带 id；上下文和能力缺省时用最保守的值 ---
const model = value => {
    if (!isObject(value) || typeof value.id !== 'string' || !value.id) throw fail(400, 'provider model must have an id')
    return {
        id: value.id,
        name: typeof value.name === 'string' && value.name ? value.name : value.id,
        context: Number(value.context) > 0 ? Number(value.context) : 128000,
        capabilities: Array.isArray(value.capabilities) ? value.capabilities : ['text', 'tools'],
    }
}

// --- 一个供应商只保留连接需要的字段 ---
const provider = value => {
    if (!isObject(value) || typeof value.name !== 'string' || !value.name) throw fail(400, 'provider must have a name')
    return {
        name: value.name,
        baseURL: typeof value.baseURL === 'string' ? value.baseURL : '',
        apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
        protocol: typeof value.protocol === 'string' ? value.protocol : 'openai-compatible',
        enabled: value.enabled !== false,
        stream: value.stream !== false,
        headers: value.headers ?? {},
        body: isObject(value.body) ? value.body : {},
        models: (Array.isArray(value.models) ? value.models : []).map(model),
    }
}

// --- 按任务的模型指向；没配就是空字符串 ---
const target = value => isObject(value)
    ? {
        provider: typeof value.provider === 'string' ? value.provider : '',
        model: typeof value.model === 'string' ? value.model : '',
    }
    : { provider: '', model: '' }

// --- 当前配置形状；未知字段不进入内存，也不写回磁盘 ---
const normalize = raw => {
    const config = isObject(raw) ? raw : {}
    const prompt = isObject(config.prompt) ? config.prompt : {}
    const system = typeof prompt.system === 'string'
        ? prompt.system
        : (prompt.seeded === true ? '' : DEFAULT_PROMPT)

    return {
        providers: (Array.isArray(config.providers) ? config.providers : []).map(provider),
        models: {
            chat: target(config.models?.chat),
            compact: target(config.models?.compact),
            title: target(config.models?.title),
            task: target(config.models?.task),
        },
        mcp: isObject(config.mcp) ? config.mcp : {},
        permission: isObject(config.permission) ? config.permission : {},
        prompt: { system, seeded: true },
        compact: {
            threshold: Number(config.compact?.threshold) >= 0.1 && Number(config.compact?.threshold) <= 0.99
                ? Number(config.compact.threshold)
                : 0.8,
        },
    }
}

// --- 读取配置；测试可以传一个临时路径，不碰用户真实配置 ---
const read = async (path = Path.config()) => {
    const file = Bun.file(path)                              // 指向磁盘上的配置文件
    const raw = await file.exists() ? await file.json() : {} // 第一次运行时还没有文件，按空配置处理
    const config = normalize(raw)                            // 只收当前形状并补默认值
    Object.keys(store.config).forEach(key => delete store.config[key]) // 先清掉内存里的现有键
    Object.assign(store.config, config)                      // 再把当前配置整份放回去
    return store.config
}

// --- 整体替换并保存 ---
const set = async newConfig => {
    if (!isObject(newConfig)) throw fail(400, 'config must be an object') // 配置只能是一整个对象
    const config = normalize(newConfig)                            // 用户提交的配置也按当前形状收一遍
    Object.keys(store.config).forEach(key => delete store.config[key]) // 清掉内存里的现有键
    Object.assign(store.config, config)                            // 放进这份新配置
    return save()                                                  // 立刻落盘
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
