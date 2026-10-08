/*
 * 会话运行设置：模式、按类别的自动批准、用哪个模型干哪件事、以及几项能力开关。
 *
 * 这里的每一项都直接对应 agent-core 的 config 字段，不自己发明一套概念：
 *   mode        → 决定这次会话能用哪些工具（plan 只给只读工具）
 *   autoApprove → 免掉逐个工具的审批弹窗，按类别分别开关，规则本身仍写在 permission 里
 *   capabilities→ 图像、提示缓存、流式输出这些按模型能力开关，默认全开
 *   uses        → 哪件事用哪个模型（压缩 / 标题 / 子任务），不点名就和主模型共用
 *   autoApproveLimit → 自动批准的刹车：连着放行多少次就停下来问
 * 设置存在会话目录的 settings.json 里，所以换台机器打开同一个会话还是这套设置。
 * 调用示例：
 *   const settings = await Settings.read({ sessionId })          // 读这条会话的运行设置
 *   await Settings.save({ sessionId, mode: 'plan' })             // 只改点名的那几项
 *   await Settings.save({ sessionId, autoApprove: { read: true } })   // 只让"读取"免询问
 *   Settings.toAgentConfig({ settings })                         // 变成 agent-core 认的字段
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import Path from '../utils/path.js'
import Store from '../store.js' // 设置跟着会话一起放在内存里，避免每次都读盘。
import fail from '../utils/fail.js' // 填错模式名时按填错处理。
import Kind from '../utils/tool-kind.js' // 类别名单只有一处，这里不重复写。

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

const DEFAULTS = {
    mode: 'build',
    autoApprove: autoApproveDefaults(),
    autoApproveLimit: APPROVE_LIMIT,
    capabilities: {
        image: true,
        cache: true,
        stream: true,
    },
    // 空对象表示"都用主模型"，这是绝大多数人的用法。
    uses: {},
    // 标题默认自动生成；用户关掉就一直是"新对话"。
    autoTitle: true,
}

// 两种模式，对应 opencode 的 plan / build：
// plan 只给只读工具，模型只能看不能改，用来先把方案说清楚；
// build 给全套工具，正常干活。
const MODES = ['plan', 'build']

/**
 * 把用户给的值夹到合法范围内，不认识的值直接忽略。
 * 宁可保持原样也不把一份坏设置写进磁盘——坏设置会让会话再也建不起来。
 * @param {object} input 用户提交的部分设置。
 * @param {object} base 已有的设置，缺省项从它继承。
 * @returns {object} 补齐后的完整设置。
 */
const normalize = (input = {}, base = DEFAULTS) => {
    const merged = { ...base, ...input }
    if (!MODES.includes(merged.mode)) throw fail(400, `mode must be plan or build, got: ${input.mode}`)

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

    // 刹车：连着放行这么多次就停下来问。只收非负整数，0 表示不设上限，别的值保持原样。
    const rawLimit = input.autoApproveLimit === undefined ? base.autoApproveLimit : input.autoApproveLimit
    const parsedLimit = Number(rawLimit)
    return {
        mode: merged.mode,
        autoApprove,
        autoApproveLimit: Number.isInteger(parsedLimit) && parsedLimit >= 0 ? parsedLimit : base.autoApproveLimit,
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
    // 第一次跑的会话还没有设置文件，用默认值就行。
    const settings = await file.exists() ? await loadOrDefault(file) : DEFAULTS
    Store.settings.set(sessionId, settings)
    return settings
}

// 设置文件可能存在但内容坏了，那时退回默认值而不是让整个会话打不开。
const loadOrDefault = async file => {
    try {
        return normalize(await file.json(), DEFAULTS)
    } catch {
        return DEFAULTS
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
 * plan 模式怎么实现的：不去改系统提示词，而是不给写工具。
 * 提示词注入会让模型"被告知"不要写，去掉工具则是"没法写"——
 * 后者不依赖模型听话，而且 system 保持为空，默认全原生。
 * @param {{ settings: object }} input
 * @returns {{ capabilities: object, cache: boolean, stream: boolean, readOnly: boolean }}
 *   readOnly 由装配工具表的那一处转成 Agent.tool.omit。
 */
const toAgentConfig = ({ settings }) => ({
    capabilities: { image: settings.capabilities.image },
    // 提示词缓存和流式输出是 agent-core 自己的字段，不是 capabilities 的一部分。
    cache: settings.capabilities.cache,
    stream: settings.capabilities.stream,
    readOnly: settings.mode === 'plan',
    // 哪件事用哪个模型，交给 Config.resolve 翻成 agent-core 认的 config.compact 那些。
    uses: settings.uses,
})

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
    read, save, toAgentConfig, approves, remove,
    DEFAULTS, MODES, USES,
    // 类别清单也从这里给出去，界面画开关时不用再引第二个模块。
    KINDS: Kind.KINDS,
}
