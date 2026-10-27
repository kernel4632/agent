/*
 * 会话运行设置：智能体、按类别的自动批准、用哪个模型干哪件事、以及几项能力开关。
 *
 * 这里的每一项都直接对应 agent-core 的 config 字段，不自己发明一套概念：
 *   agent       → 决定这次会话用哪个身份、哪些工具、额外提示词和权限覆盖
 *   autoApprove → 免掉逐个工具的审批弹窗，按类别分别开关，规则本身仍写在 permission 里
 *   capabilities→ 图像、提示缓存、流式输出这些按模型能力开关，默认全开
 *   uses        → 哪件事用哪个模型（压缩 / 标题 / 子任务），不点名就和主模型共用
 *   autoApproveLimit → 自动批准的刹车：连着放行多少次就停下来问
 * 设置存在会话目录的 settings.json 里，所以换台机器打开同一个会话还是这套设置。
 * 旧版本把 agent 叫 mode；读取旧设置时自动迁移，新写入只认 agent。
 * 调用示例：
 *   const settings = await Settings.read({ sessionId })          // 读这条会话的运行设置
 *   await Settings.save({ sessionId, agent: 'plan' })             // 只改点名的那几项
 *   Settings.toAgentConfig({ settings })                         // 变成 agent-core 认的字段
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import Path from '../utils/path.js'
import Agents from '../features/agents.js' // 智能体定义只有这一处。
import Config from './config.js' // 全局配置和权限规则。
import Store from '../store.js' // 设置跟着会话一起放在内存里，避免每次都读盘。
import fail from '../utils/fail.js' // 填错智能体名时按填错处理。
import Kind from '../utils/tool-kind.js' // 类别名单只有一处，这里不重复写。
import { canonical } from '../utils/tool-names.js' // 旧自定义智能体里的工具名继续有效。

/*
 * 哪件事可以单独指定模型。不点名就和主模型共用——这一条很重要：
 * 用户大部分时候只想选一次模型，不该被逼着为每件事都配一遍。
 *   compact → 压缩上下文时的总结（agent-core 自带的 config.compact，我们只是把它接出来）
 *   title   → 生成会话标题
 *   subtask → 开子任务时的那个子 agent
 * 界面按这份清单画选择框，加一项只改这里。
 */
export const USES = [
    { use: 'compact', label: '压缩上下文', hint: '把长对话总结成一段，不需要主模型那么聪明' },
    { use: 'title', label: '生成标题', hint: '给会话起一个短标题，用便宜快的小模型就够' },
    { use: 'subtask', label: '子任务', hint: '子 agent 干活时用的模型' },
]

// 哪几件事可以单独指定模型，查一遍就知道该不该认这个字段。
const USE_NAMES = USES.map(item => item.use)

/*
 * 自动批准的刹车：连着放行这么多次就停下来问一句。0 表示不设上限。
 * 模型跑偏的典型表现不是"做了一件坏事"，而是"同一件小事做了五十遍"——
 * 比如反复重试同一个失败的命令，所以数次数就够了。
 * 不做花费上限：我们的用户都是无限 token，没有预算概念，设了也没有意义。
 */
const APPROVE_LIMIT = 50

/*
 * 默认值。刻意和 agent-core 的默认保持一致，做到"默认全原生"：
 * 不写任何提示词注入，能力全开，流式和提示词缓存都按 agent-core 的默认开着。
 *
 * 自动批准默认全部关闭——不替用户预先放行任何东西。
 * 这份默认值由下面的 normalize 从 Kind.KINDS 现算出来，所以加一类不用回来改这里。
 *
 * 刹车默认开着（50 次）。这是唯一一处"默认不是最宽松"的地方：
 * 已经开了自动批准，再完全不设上限，跑飞了一直做同一件小事都没人管。
 * 用户想彻底放开就设成 0。
 */
const autoApproveDefaults = () => Object.fromEntries(Kind.KINDS.map(item => [item.kind, false]))

// 全局默认值只认配置里合法的部分；写错或没写时回到内置默认。
const validThreshold = value => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0.1 && parsed <= 0.99 ? parsed : 0.8
}

const globalUses = () => {
    const source = Config.get().uses
    const uses = {}
    if (!source || typeof source !== 'object' || Array.isArray(source)) return uses
    for (const name of USE_NAMES) {
        const target = source[name]
        if (target?.provider && target?.model) uses[name] = { provider: target.provider, model: target.model }
    }
    return uses
}

/**
 * 新会话的默认设置：模型能力、任务模型、压缩阈值和自动标题可以从设置页持久化。
 * 自动批准仍然默认全关，不替用户预先放行。
 * @returns {object} 新会话的完整默认设置。
 */
const defaultSettings = () => {
    const config = Config.get()
    const capabilities = config.capabilities || {}
    return {
        // 默认用执行智能体；旧字段 mode 在 normalize 里做兼容。
        agent: 'build',
        autoApprove: autoApproveDefaults(),
        autoApproveLimit: APPROVE_LIMIT,
        // 上下文用到 80% 时自动总结，和 agent-core 的默认一致。
        compactThreshold: validThreshold(config.compactThreshold),
        capabilities: {
            image: capabilities.image !== false,
            cache: capabilities.cache !== false,
            stream: capabilities.stream !== false,
        },
        // 空对象表示"都用主模型"，这是绝大多数人的用法。
        uses: globalUses(),
        // 标题默认自动生成；用户关掉就一直是"新对话"。
        autoTitle: config.autoTitle !== false,
    }
}

// 兼容旧调用方：模块加载时的一份默认快照，不随配置变化。新会话请用 defaultSettings()。
const DEFAULTS = {
    agent: 'build',
    autoApprove: autoApproveDefaults(),
    autoApproveLimit: APPROVE_LIMIT,
    compactThreshold: 0.8,
    capabilities: { image: true, cache: true, stream: true },
    uses: {},
    autoTitle: true,
}

/**
 * 当前可用的智能体：内置的加自定义的，定义统一来自 features/agents.js。
 * @returns {Array<object>} 完整智能体清单。
 */
const agents = () => Agents.list(Config.get())

/**
 * 查一个智能体是不是存在。
 * @param {string} name 智能体名。
 * @returns {object|null} 智能体定义；不认识时是 null。
 */
const agentInfo = name => Agents.get(Config.get(), name)

/**
 * 这个智能体点名的工具；不点名时返回 null。
 * @param {{ agent: string }} settings 会话设置。
 * @returns {string[]|null} 工具名单或 null。
 */
const toolsFor = ({ agent }) => {
    const tools = agentInfo(agent)?.tools
    return tools ? [...new Set(tools.map(name => canonical(name)))] : null
}

/**
 * 这个智能体自己的权限覆盖；没有时是 null。
 * @param {{ settings?: object }} input 会话设置。
 * @returns {object|null} permission 规则或 null。
 */
const agentPermission = ({ settings } = {}) => agentInfo(settings?.agent)?.permission || null

/**
 * 这个智能体指定的模型；没有时是 null，表示沿用会话模型。
 * @param {{ settings?: object }} input 会话设置。
 * @returns {{ provider: string, model: string }|null} 模型或 null。
 */
const modelFor = ({ settings } = {}) => agentInfo(settings?.agent)?.model || null

/**
 * 把用户给的值夹到合法范围内，不认识的值直接忽略。
 * 宁可保持原样也不把一份坏设置写进磁盘——坏设置会让会话再也建不起来。
 * @param {object} input 用户提交的部分设置。
 * @param {object} base 已有的设置，缺省项从它继承。
 * @returns {object} 补齐后的完整设置。
 */
const normalize = (input = {}, base = defaultSettings()) => {
    const merged = { ...base, ...input }
    // 旧版本把 agent 叫 mode；旧设置文件和老客户端都还认，新写入只写 agent。
    const requested = input.agent !== undefined ? input.agent : input.mode
    const agent = requested !== undefined ? requested : base.agent
    if (!agentInfo(agent)) throw fail(400, `agent must be one of ${agents().map(item => item.name).join(', ')}, got: ${requested ?? input.agent}`)

    // 自动批准按类别合并：只改了 read 的话，别的几类保持原样。
    // 布尔值是老版本的写法（一个总开关），读到时摊到每一类上，旧设置不至于失效。
    const source = typeof input.autoApprove === 'boolean'
        ? Object.fromEntries(Kind.KINDS.map(item => [item.kind, input.autoApprove]))
        : (input.autoApprove || {})
    const autoApprove = {}
    for (const item of Kind.KINDS) autoApprove[item.kind] = (source[item.kind] ?? base.autoApprove[item.kind]) === true

    const capabilities = { ...base.capabilities, ...(input.capabilities || {}) }

    /*
     * 哪件事用哪个模型。只留三件事里认识的，并且只留"名字和模型都填全了"的：
     *   { compact: { provider: 'local', model: '小模型' } }
     * 用户把某件事清空（传 null 或空对象）表示改回"和主模型共用"，
     * 所以这里遇到空值要把它删掉，不能留着半条记录让后面去猜。
     */
    const uses = { ...base.uses }
    const changed = input.uses || {}
    for (const name of USE_NAMES) {
        if (!(name in changed)) continue
        const target = changed[name]
        if (target?.provider && target?.model) uses[name] = { provider: target.provider, model: target.model }
        else delete uses[name]
    }

    // 自动压缩阈值：只收 0.1 到 0.99，写错保持原值。
    const rawThreshold = input.compactThreshold === undefined ? base.compactThreshold : input.compactThreshold
    const parsedThreshold = Number(rawThreshold)
    const compactThreshold = Number.isFinite(parsedThreshold) && parsedThreshold >= 0.1 && parsedThreshold <= 0.99
        ? parsedThreshold
        : base.compactThreshold

    // 刹车：连着放行这么多次就停下来问。只收非负整数，0 表示不设上限，别的值保持原样。
    const rawLimit = input.autoApproveLimit === undefined ? base.autoApproveLimit : input.autoApproveLimit
    const parsedLimit = Number(rawLimit)
    return {
        agent,
        autoApprove,
        autoApproveLimit: Number.isInteger(parsedLimit) && parsedLimit >= 0 ? parsedLimit : base.autoApproveLimit,
        compactThreshold,
        capabilities: {
            image: capabilities.image !== false,
            cache: capabilities.cache !== false,
            stream: capabilities.stream !== false,
        },
        uses,
        // 只有明确传 false 才关，别的值都当开着。
        autoTitle: merged.autoTitle !== false,
    }
}

/**
 * 读一条会话的运行设置，没存过时给默认值。
 * @param {{ sessionId: string }} session
 * @returns {Promise<object>} 完整的运行设置。
 */
const read = async ({ sessionId }) => {
    if (Store.settings.has(sessionId)) return Store.settings.get(sessionId)
    const file = Bun.file(Path.settings(sessionId))
    // 第一次跑的会话还没有设置文件，用全局默认值就行。
    const settings = await file.exists() ? await loadOrDefault(file) : defaultSettings()
    Store.settings.set(sessionId, settings)
    return settings
}

// 设置文件可能存在但内容坏了，那时退回默认值而不是让整个会话打不开。
const loadOrDefault = async file => {
    try {
        return normalize(await file.json(), defaultSettings())
    } catch {
        return defaultSettings()
    }
}

/**
 * 改一条会话的运行设置，只改点名的那几项，其余保持原样。
 * @param {{ sessionId: string } & object} change 会话编号加上要改的字段。
 * @returns {Promise<object>} 保存后的完整设置。
 * @throws {Error} 模式名不认识时按填错处理（400）。
 */
const save = async ({ sessionId, ...change }) => {
    const current = await read({ sessionId })
    const settings = normalize(change, current)
    Store.settings.set(sessionId, settings)

    const path = Path.settings(sessionId)
    await mkdir(dirname(path), { recursive: true })
    // 原子写入，避免程序中断留下半份 JSON 让这个会话再也打不开。
    await writeFile(path, JSON.stringify(settings, null, 2))
    return settings
}

/**
 * 把设置翻译成 agent-core 认的 config 字段。
 *
 * plan 智能体怎么实现的：不去改系统提示词，而是不给写工具。
 * 提示词注入会让模型"被告知"不要写，去掉工具则是"没法写"——
 * 后者不依赖模型听话，而且 system 保持为空，默认全原生。
 * 自定义智能体的 instructions 是用户明确写的角色说明，会拼在系统提示词后面。
 * @param {{ settings: object }} input
 * @returns {{ capabilities: object, cache: boolean, stream: boolean, readOnly: boolean, instructions: string }}
 *   readOnly 由装配工具表的那一处转成 Agent.tool.omit。
 */
const toAgentConfig = ({ settings }) => {
    const agent = agentInfo(settings.agent)
    return {
        capabilities: { image: settings.capabilities.image },
        // 提示词缓存和流式输出是 agent-core 自己的字段，不是 capabilities 的一部分。
        cache: settings.capabilities.cache,
        stream: settings.capabilities.stream,
        // 自定义智能体也可以声明 readOnly；不认识或已被删掉时按可写处理，不让会话打不开。
        readOnly: agent?.readOnly === true,
        // 智能体自己的角色说明；Config.resolve 会把它拼到全局提示词后面。
        instructions: agent?.instructions || '',
        // 上下文用到这个比例时自动压缩；agent-core 自己认这个字段。
        compactThreshold: settings.compactThreshold,
        // 哪件事用哪个模型，交给 Config.resolve 翻成 agent-core 认的 config.compact 那些。
        uses: settings.uses,
    }
}

/**
 * 这次工具调用还该不该问用户。
 *
 * 三种结果：开了自动批准 → 不问；不需要批准的工具（记清单、结束循环）→ 不问；
 * 其余（没开自动批准、或者根本没分类）→ 问。
 * @param {{ settings?: object, toolName: string, mcpServers?: string[] }} call
 *   settings 是这条会话的运行设置；没有设置时按"全部要问"处理。
 * @returns {boolean} true 表示这一类免询问。
 */
const approves = ({ settings, toolName, mcpServers }) => {
    const kind = Kind.of({ toolName, mcpServers })
    // 记清单和结束循环没有"要不要批准"这回事，问也只会让用户一直点同意。
    if (kind === 'never') return true
    // 没读到设置时宁可按"要问"处理，不替用户放行。
    if (!settings) return false
    // 没分类的工具（other）没有自动批准这个选项，一律要问。
    return settings.autoApprove[kind] === true
}

/**
 * 会话删除时清掉内存里的设置。
 * @param {{ sessionId: string }} session
 * @returns {void}
 */
const remove = ({ sessionId }) => {
    Store.settings.delete(sessionId)
    // 自动批准的计数也跟着会话一起清掉，不然会留一条永远没人读的记录。
    Store.autoApproved.delete(sessionId)
}
export default {
    read, save, toAgentConfig, approves, remove, agents, toolsFor,
    agentInfo, agentPermission, modelFor,
    defaultSettings, DEFAULTS, USES,
    // 类别清单也从这里给出去，界面画开关时不用再引第二个模块。
    KINDS: Kind.KINDS,
}
