/*
 * 会话运行设置：模式（plan / build）、自动批准、以及几项模型能力开关。
 *
 * 这里的每一项都直接对应 agent-core 的 config 字段，不自己发明一套概念：
 *   mode        → 决定这次会话能用哪些工具（plan 只给只读工具）
 *   autoApprove → 免掉逐个工具的审批弹窗，规则本身仍写在 permission 里
 *   capabilities→ 图像、提示缓存、流式输出这些按模型能力开关，默认全开
 * 设置存在会话目录的 settings.json 里，所以换台机器打开同一个会话还是这套设置。
 * 调用示例：
 *   const settings = await Settings.read({ sessionId })          // 读这条会话的运行设置
 *   await Settings.save({ sessionId, mode: 'plan' })             // 只改点名的那几项
 *   Settings.toAgentConfig({ settings })                         // 变成 agent-core 认的字段
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import Path from '../utils/path.js'
import Store from '../store.js' // 设置跟着会话一起放在内存里，避免每次都读盘。
import fail from '../utils/fail.js' // 填错模式名时按填错处理。

/*
 * 默认值。刻意和 agent-core 的默认保持一致，做到"默认全原生"：
 * 不写任何提示词注入，能力全开，流式和提示词缓存都按 agent-core 的默认开着。
 */
const DEFAULTS = {
    mode: 'build',
    autoApprove: false,
    capabilities: {
        image: true,
        cache: true,
        stream: true,
    },
}

// 两种模式，对应 opencode 的 plan / build：
// plan 只给只读工具，模型只能看不能改，用来先把方案说清楚；
// build 给全套工具，正常干活。
const MODES = ['plan', 'build']

/*
 * plan 模式要去掉的工具：能改磁盘的。
 * 用"去掉写工具"而不是"只留读工具"：内置工具增加时（比如新加一个只读工具），
 * 它会自动在 plan 模式下可用，不用回来改这份名单。名单里写的是要禁用的少数。
 */
const WRITE_TOOLS = ['file_write', 'edit', 'apply_patch', 'shell']
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
    const capabilities = { ...base.capabilities, ...(input.capabilities || {}) }
    // 只留认识的键，界面传了别的东西也不会被存进去。
    return {
        mode: merged.mode,
        autoApprove: Boolean(merged.autoApprove),
        capabilities: {
            image: capabilities.image !== false,
            cache: capabilities.cache !== false,
            stream: capabilities.stream !== false,
        },
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
    const settings = file.exists ? await loadOrDefault(file) : DEFAULTS
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
})

/**
 * 会话删除时清掉内存里的设置。
 * @param {{ sessionId: string }} session
 * @returns {void}
 */
const remove = ({ sessionId }) => {
    Store.settings.delete(sessionId)
}
export default { read, save, toAgentConfig, remove, DEFAULTS, MODES, WRITE_TOOLS }
