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

import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFile } from 'atomically'
import store, { DEFAULT_PROMPT } from '../store.js'
import Path from '../utils/path.js'
import fail from '../utils/fail.js'
import Text from '../utils/text.js'


const isObject = Text.isObject
const BACKUP_LIMIT = 20                 // 最多保留 20 个备份，超过就删旧的
const MASK = '••••••'                 // 导出配置时用它覆盖 apiKey 等敏感字段
const BACKUP_ID = /^config-[A-Za-z0-9-]+\.json$/  // 备份文件名格式，不匹配的文件被忽略

// --- 按任务的默认模型 ---
const MODELS = [
    { task: 'chat', label: '对话', hint: '会话默认使用的模型' },
    { task: 'compact', label: '压缩上下文', hint: '把长对话总结成一段' },
    { task: 'title', label: '生成标题', hint: '给会话起一个短标题' },
    { task: 'task', label: '子任务', hint: '子 agent 干活时用的模型' },
]

// --- 一个模型必须带 id；上下文和能力缺省时用最保守的值 ---
const finiteNumber = (value, min, max) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= min && number <= max ? number : undefined
}
const model = value => {
    if (!isObject(value) || typeof value.id !== 'string' || !value.id) throw fail(400, 'provider model must have an id')
    const result = {
        id: value.id,
        name: typeof value.name === 'string' && value.name ? value.name : value.id,
        family: typeof value.family === 'string' ? value.family.trim() : '',
        context: Number(value.context) > 0 ? Number(value.context) : 128000,
        capabilities: Array.isArray(value.capabilities) ? value.capabilities : ['text', 'tools'],
    }
    const maxOutput = Number(value.maxOutput)
    if (Number.isInteger(maxOutput) && maxOutput > 0) result.maxOutput = maxOutput
    const temperature = finiteNumber(value.temperature, 0, 2)
    if (temperature !== undefined) result.temperature = temperature
    const topP = finiteNumber(value.topP, 0, 1)
    if (topP !== undefined) result.topP = topP
    const seed = Number(value.seed)
    if (Number.isInteger(seed) && seed >= 0) result.seed = seed
    if (isObject(value.body) && Object.keys(value.body).length) result.body = value.body
    return result
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

// --- 压缩保留量：四个值都有默认值，但用户显式写的 0 要保住 ---
// firstTurns = 0 是合法且常用的配置（压缩后不带最初那几轮原文），所以用 ?? 而不是 ||，
// 否则 0 会被当成“没填”退回默认值。轮数必须是非负整数，占比必须落在 [0,1]。
const keepTurns = (value, fallback) => {
    if (value === undefined || value === null) return fallback
    const turns = Number(value)
    if (!Number.isInteger(turns) || turns < 0) throw fail(400, 'contextKeep turns must be a non-negative integer')
    return turns
}
const keepShare = (value, fallback) => {
    if (value === undefined || value === null) return fallback
    const share = Number(value)
    if (!Number.isFinite(share) || share < 0 || share > 1) throw fail(400, 'contextKeep share must be between 0 and 1')
    return share
}
const contextKeep = value => {
    if (value !== undefined && value !== null && !isObject(value)) throw fail(400, 'contextKeep must be an object')
    const raw = isObject(value) ? value : {}
    return {
        firstTurns: keepTurns(raw.firstTurns, 3),
        recentTurns: keepTurns(raw.recentTurns, 3),
        firstShare: keepShare(raw.firstShare, 0.2),
        recentShare: keepShare(raw.recentShare, 0.3),
    }
}

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
        contextKeep: contextKeep(config.contextKeep),
    }
}

// --- 配置备份：只保留当前文件的上一版，恢复时也走正常 normalize ---
const maskSecrets = raw => {
    const copy = structuredClone(raw)
    for (const provider of copy.providers || []) {
        if (provider.apiKey) provider.apiKey = MASK
    }
    for (const server of Object.values(copy.mcp || {})) {
        if (!isObject(server)) continue
        for (const field of ['env', 'headers']) {
            if (!isObject(server[field])) continue
            for (const key of Object.keys(server[field])) {
                if (typeof server[field][key] === 'string' && server[field][key]) server[field][key] = MASK
            }
        }
    }
    return copy
}

const restoreMaskedSecrets = (next, current) => {
    const currentProviders = new Map((current.providers || []).map(item => [item.name, item]))
    for (const provider of next.providers || []) {
        if (provider.apiKey !== MASK) continue
        provider.apiKey = currentProviders.get(provider.name)?.apiKey || ''
    }
    for (const [name, server] of Object.entries(next.mcp || {})) {
        const old = current.mcp?.[name]
        for (const field of ['env', 'headers']) {
            if (!isObject(server[field]) || !isObject(old?.[field])) continue
            for (const key of Object.keys(server[field])) {
                if (server[field][key] === MASK) server[field][key] = old[field][key] || ''
            }
        }
    }
    return next
}

// 备份 id 包含时间戳和短 UUID，排序时按时间早晚。
const backupId = () => `config-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}.json`

// 対备份文件按时间排序，就最旧的删掉，保证总数不超过 BACKUP_LIMIT。
const pruneBackups = async dir => {
    const entries = (await readdir(dir, { withFileTypes: true }))
        .filter(entry => entry.isFile() && BACKUP_ID.test(entry.name))
        .map(entry => entry.name)
        .sort()
        .reverse()
    await Promise.all(entries.slice(BACKUP_LIMIT).map(name => rm(join(dir, name), { force: true })))
}

const snapshot = async () => {
    const source = Path.config()
    if (!await Bun.file(source).exists()) return null
    const dir = Path.configBackups()
    await mkdir(dir, { recursive: true })
    const id = backupId()
    await writeFile(join(dir, id), await Bun.file(source).text())
    await pruneBackups(dir)
    return id
}

const backupPath = id => {
    if (!BACKUP_ID.test(String(id || ''))) throw fail(400, 'invalid config backup id')
    return join(Path.configBackups(), id)
}

const backupList = async () => {
    const dir = Path.configBackups()
    await mkdir(dir, { recursive: true })
    const entries = (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isFile() && BACKUP_ID.test(entry.name))
    const list = []
    for (const entry of entries) {
        const path = join(dir, entry.name)
        try {
            const stat = await Bun.file(path).stat()
            const raw = await Bun.file(path).json()
            list.push({
                id: entry.name,
                createdAt: stat.mtimeMs,
                size: stat.size,
                providers: Array.isArray(raw.providers) ? raw.providers.length : 0,
                models: Array.isArray(raw.providers) ? raw.providers.reduce((sum, provider) => sum + (provider.models?.length || 0), 0) : 0,
            })
        } catch {
            // 坏备份不阻塞列表；恢复时会单独报错。
        }
    }
    return list.sort((a, b) => b.createdAt - a.createdAt)
}

// 读读一个备份的内容；敏感字段用莞樱覆盖，不暴露密钥。
const backup = async id => {
    const path = backupPath(id)
    if (!await Bun.file(path).exists()) throw fail(404, `config backup not found: ${id}`)
    let raw
    try {
        raw = await Bun.file(path).json()
    } catch {
        throw fail(400, `config backup is not valid JSON: ${id}`)
    }
    const stat = await Bun.file(path).stat()
    return { id, createdAt: stat.mtimeMs, config: maskSecrets(raw) }
}

// 恢复到某个备份：就叫 set，不特殊处理，读进来的内容也会经过 normalize。
const restore = async ({ id } = {}) => {
    const path = backupPath(id)
    if (!await Bun.file(path).exists()) throw fail(404, `config backup not found: ${id}`)
    let raw
    try {
        raw = await Bun.file(path).json()
    } catch {
        throw fail(400, `config backup is not valid JSON: ${id}`)
    }
    await set(raw)
    return { ok: true, id }
}

// 导出配置：secrets=true 时包含敏感字段，默认褶盖。
const exportConfig = ({ secrets = false } = {}) => secrets === true || secrets === '1'
    ? structuredClone(store.config)
    : maskSecrets(store.config)

// 导入配置：与当前配置合并，读入的 MASK 字段恢复为内存里的实际密钥。
const importConfig = async ({ config } = {}) => {
    if (!isObject(config)) throw fail(400, 'config must be an object')
    await set(restoreMaskedSecrets(structuredClone(config), store.config))
    return { ok: true }
}
// 清掉内存时用 delete 而不是用新对象替换 store.config：其他模块拿的是对象的引用，
// 如果用新对象替换，它们的引用就指向了旧的对象。
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
    await save()                                                   // 立刻落盘
    return store.config
}

const get = () => store.config

// --- 界面只读元数据：按任务的模型标签 ---
const meta = () => ({ models: MODELS })

// --- 把内存里的配置写回磁盘；审批记住规则时也用它 ---
const save = async () => {
    const path = Path.config()                                      // 用户数据目录下的 config.json
    await mkdir(dirname(path), { recursive: true })                 // 第一次保存时目录可能还不存在
    await snapshot()                                                // 永远保留上一版，恢复/误覆盖都有退路
    await writeFile(path, JSON.stringify(store.config, null, 2))    // 原子写入，避免中途留下半份 JSON
    return store.config
}

export default {
    MODELS, read, set, get, meta, save,
    backups: backupList, backup, restore, export: exportConfig, import: importConfig,
}
