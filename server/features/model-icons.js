/*
 * 模型 family/图标解析：把 models.dev 当作实时目录，不在仓库里维护 logo 资产。
 *
 * - family 是原厂/lab，例如 openai、anthropic、deepseek、moonshotai；
 * - 目录优先用 canonical_model_id 判断中转站模型属于哪个 lab；
 * - 只在没有 canonical 信息时才用一组低风险别名做“建议”，多个匹配则判为歧义；
 * - logo 从 models.dev 代理并缓存，新模型或换 logo 不需要发版。
 *
 * 调用示例：
 *   await ModelIcons.suggest({ model: 'deepseek-v4-flash' })
 *   await ModelIcons.icon({ family: 'deepseek' })
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import Path from '../utils/path.js'

const CATALOG_URL = 'https://models.dev/api.json'
const CATALOG_TTL = 12 * 60 * 60 * 1000
const LOGO_TTL = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT = 20 * 1000

// 只用于“建议”，不是图标表；真正的 family 优先来自 canonical_model_id。
const KEYWORDS = [
    ['openai', /\b(gpt|openai|codex|o[1-9])\b/],
    ['anthropic', /\b(claude|anthropic)\b/],
    ['google', /\b(gemini|gemma|google)\b/],
    ['deepseek', /\bdeepseek\b/],
    ['moonshotai', /\b(kimi|moonshot)\b/],
    ['zhipuai', /\b(glm|chatglm|zhipu)\b/],
    ['alibaba', /\b(qwen|qwq|qvq|tongyi)\b/],
    ['minimax', /\b(minimax|abab)\b/],
    ['bytedance', /\b(doubao|seedream|seedance)\b/],
    ['xai', /\b(grok|xai)\b/],
    ['mistral', /\b(mistral|mixtral|codestral)\b/],
    ['meta', /\b(llama|meta)\b/],
    ['stepfun', /\bstep\b/],
    ['iflytek', /\bspark\b/],
    ['baidu', /\bernie\b/],
    ['tencent', /\bhunyuan\b/],
    ['cohere', /\bcommand[- ]r\b/],
    ['nvidia', /\bnemotron\b/],
]
const FAMILY_ALIASES = {
    kimi: 'moonshotai',
    moonshot: 'moonshotai',
    glm: 'zhipuai',
    zhipu: 'zhipuai',
    'z-ai': 'zhipuai',
    qwen: 'alibaba',
    claude: 'anthropic',
    gpt: 'openai',
    gemini: 'google',
    grok: 'xai',
    doubao: 'bytedance',
    llama: 'meta',
}

const catalog = { loadedAt: 0, index: null, promise: null }
const logos = new Map()

const normalizeModel = value => String(value || '').trim().toLowerCase()
const familyPattern = /^[a-z0-9][a-z0-9-]*$/

const normalizeFamily = value => {
    const family = normalizeModel(value)
    if (!family) return ''
    return FAMILY_ALIASES[family] || family
}

const pushLab = (map, key, lab) => {
    if (!key || !lab) return
    const list = map.get(key) || []
    if (!list.includes(lab)) list.push(lab)
    map.set(key, list)
}

// 把 provider→models 的目录展开成模型 ID → 候选 lab。中转站的同名模型可能来自多个 lab，
// 候选不唯一时保持歧义，不猜。
const buildIndex = data => {
    const providers = new Set(Object.keys(data || {}))
    const exact = new Map()
    for (const [providerId, provider] of Object.entries(data || {})) {
        for (const [modelId, model] of Object.entries(provider?.models || {})) {
            const canonical = normalizeModel(model?.canonical_model_id)
            const lab = canonical.split('/')[0] || normalizeModel(providerId)
            pushLab(exact, normalizeModel(modelId), lab)
            pushLab(exact, `${normalizeModel(providerId)}/${normalizeModel(modelId)}`, lab)
            if (canonical) pushLab(exact, canonical, lab)
        }
    }
    return { providers, exact }
}

const readDisk = async () => {
    try {
        return JSON.parse(await readFile(Path.modelCatalog(), 'utf8'))
    } catch {
        return null
    }
}

const readDiskMeta = async () => {
    try {
        return (await Bun.file(Path.modelCatalog()).stat()).mtimeMs
    } catch {
        return 0
    }
}

const fetchJson = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
    if (!response.ok) throw new Error(`models.dev returned ${response.status}`)
    return response.json()
}

const writeDisk = async data => {
    const file = Path.modelCatalog()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(data))
}

const loadCatalog = async () => {
    const mtime = await readDiskMeta()
    if (catalog.index && Date.now() - catalog.loadedAt < CATALOG_TTL) return catalog.index
    if (mtime && Date.now() - mtime < CATALOG_TTL) {
        const data = await readDisk()
        if (data) {
            catalog.index = buildIndex(data)
            catalog.loadedAt = Date.now()
            return catalog.index
        }
    }
    try {
        const data = await fetchJson(CATALOG_URL)
        await writeDisk(data).catch(() => {})
        catalog.index = buildIndex(data)
        catalog.loadedAt = Date.now()
        return catalog.index
    } catch {
        const data = await readDisk()
        if (data) {
            catalog.index = buildIndex(data)
            catalog.loadedAt = Date.now()
            return catalog.index
        }
        catalog.index = buildIndex({})
        catalog.loadedAt = Date.now()
        return catalog.index
    }
}

const index = () => {
    if (catalog.index && Date.now() - catalog.loadedAt < CATALOG_TTL) return Promise.resolve(catalog.index)
    if (!catalog.promise) catalog.promise = loadCatalog().finally(() => { catalog.promise = null })
    return catalog.promise
}

const suggestFamily = (model, indexData) => {
    const normalized = normalizeModel(model)
    if (!normalized) return { family: '', candidates: [], ambiguous: false, source: 'empty' }

    const exact = indexData.exact.get(normalized) || []
    if (exact.length === 1) return { family: exact[0], candidates: exact, ambiguous: false, source: 'catalog' }
    if (exact.length > 1) return { family: '', candidates: exact, ambiguous: true, source: 'catalog' }

    // 命名空间前缀：openai/gpt-*、anthropic/claude-*。
    const prefix = normalized.split(/[/:]/)[0]
    if ((normalized.includes('/') || normalized.includes(':')) && indexData.providers.has(prefix)) {
        return { family: prefix, candidates: [prefix], ambiguous: false, source: 'prefix' }
    }

    const matches = KEYWORDS.filter(([, pattern]) => pattern.test(normalized)).map(([family]) => family)
    const unique = [...new Set(matches)]
    if (unique.length === 1) return { family: unique[0], candidates: unique, ambiguous: false, source: 'keyword' }
    if (unique.length > 1) return { family: '', candidates: unique, ambiguous: true, source: 'keyword' }
    return { family: '', candidates: [], ambiguous: false, source: 'none' }
}

export const suggest = async ({ model, family } = {}) => {
    const explicit = normalizeFamily(family)
    if (explicit) {
        return { family: explicit, candidates: [explicit], ambiguous: false, source: 'manual' }
    }
    const indexData = await index()
    return suggestFamily(model, indexData)
}

export const icon = async ({ model, family } = {}) => {
    const result = await suggest({ model, family })
    if (!result.family || !familyPattern.test(result.family)) return null
    if (result.source === 'manual') {
        // 手动 family 直接取 logo；不需要为了一个图标先下载整份模型目录。
    } else {
        const indexData = await index()
        if (indexData.providers.size && !indexData.providers.has(result.family)) return null
    }
    const cached = logos.get(result.family)
    if (cached && Date.now() - cached.at < LOGO_TTL) return cached.body

    try {
        const response = await fetch(`https://models.dev/logos/${encodeURIComponent(result.family)}.svg`, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
        if (!response.ok) return null
        const body = await response.text()
        if (!body.includes('<svg')) return null
        logos.set(result.family, { body, at: Date.now() })
        return body
    } catch {
        return cached?.body || null
    }
}

export const clear = () => {
    logos.clear()
    catalog.index = null
    catalog.loadedAt = 0
}

export default { suggest, icon, clear }
