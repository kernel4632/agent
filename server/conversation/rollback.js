/*
 * 会话回退：消息级回退、工具级回退、撤销回退和回退预览。
 *
 * 回退会同时改历史、磁盘文件和撤销栈；三者必须按同一顺序完成，不能留下中间状态。
 * 调用示例：
 *   await SessionRollback.rollback({ sessionId, messageId })
 *   await SessionRollback.rollbackTool({ sessionId, toolCallId })
 *   await SessionRollback.redo({ sessionId })
 */

import Store from '../agent/state.js' // 运行中的会话不能回退。
import fail from '../utils/fail.js' // 消息或工具调用不存在时按填错处理。
import History from './history.js' // 对话时间线。
import Meta from './meta.js' // 先确认会话存在。
import SessionRead from './read.js' // 回退后返回完整会话。
import Snapshot from './snapshot.js' // 文件快照。

// --- 回退会话 ---
const rollback = async ({ sessionId, messageId, files = true }) => {
    await Meta.read(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    await History.load({ sessionId })
    // 对话和文件是两件可以分开的事：用户可能只想把对话退回去接着问，也可能只想丢掉
    // agent 改的文件而留着对话看它做了什么。files 传 false 就只退对话。
    let restored = []
    if (files) {
        // 先算出回退后还留下哪些消息块，再恢复文件；文件恢复失败时对话保持原样，
        // 不会出现"消息没了但文件还在"的中间状态。
        restored = await Snapshot.restoreToMessage({ sessionId, keepMessages: History.idsBefore({ sessionId, messageId }) })
    }
    await History.rollback({ sessionId, messageId })
    await History.save({ sessionId })
    const agent = Store.agents.get(sessionId)
    if (agent) agent.history = History.get({ sessionId })
    return { ...await SessionRead.read({ sessionId }), restored }
}

// --- 看这次任务改了哪些文件 ---
const changes = async ({ sessionId }) => {
    await Meta.read(sessionId)
    // 快照记的是"任务开始时的原样"，所以这里给出的就是 agent 实际造成的改动。
    return Snapshot.diff({ sessionId })
}

/**
 * 回退之前先算清楚会改动什么，别让用户盲目确认。
 * @param {{ sessionId: string, messageId: string }} target 要回退到这条消息之前。
 * @returns {Promise<{ messages: number, files: object[] }>} 会消失的消息条数和会被恢复的文件。
 * @throws {Error} 消息不在这个会话里时按填错处理（404）。
 */
const rollbackPreview = async ({ sessionId, messageId }) => {
    await Meta.read(sessionId)
    await History.load({ sessionId })
    const history = History.get({ sessionId })
    const index = history.findIndex(message => message.messageId === messageId)
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)

    const keep = history.slice(0, index).map(message => message.id)
    return {
        messages: history.length - index,                                     // 会消失的消息条数
        files: await changedFiles({ sessionId, keep: entry => keep.includes(entry.messageId) }),
    }
}

/**
 * 退回某一次工具调用之前：只影响文件，对话不动。
 * 这是比消息回退细一层的粒度——某一个工具把文件改坏了，用户不用丢掉整轮对话。
 * @param {{ sessionId: string, toolCallId: string, files?: boolean }} target
 *   files 传 false 时只把这次调用从记录里去掉，磁盘上的文件保持现在的样子。
 * @returns {Promise<{ restored: string[] }>} 被恢复的文件绝对路径。
 */
const rollbackTool = async ({ sessionId, toolCallId, files = true }) => {
    await Meta.read(sessionId)
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    // 工具回退不改变历史，所以这里不需要 load，也不碰 History。
    const restored = files ? await Snapshot.restoreToTool({ sessionId, toolCallId }) : await Snapshot.dropTool({ sessionId, toolCallId })
    return { restored }
}

/**
 * 记过哪些工具调用，界面据此列出"可以退回到哪一步"。
 * @param {{ sessionId: string }} session
 * @returns {Promise<object[]>} 每次改过文件的工具调用，按发生顺序。
 */
const toolChanges = async ({ sessionId }) => {
    await Meta.read(sessionId)
    return Snapshot.entries({ sessionId })
}

/**
 * 这一次回退会恢复哪些文件，以及它们各自改了什么。
 * @param {{ sessionId: string, keep: (entry: object) => boolean }} scope keep 判断某条记录是否属于要保留的那一段。
 * @returns {Promise<object[]>} 会被恢复的文件；结构同 Snapshot.diff 的每一项。
 */
const changedFiles = async ({ sessionId, keep }) => {
    const droppedPaths = new Set()
    for (const entry of Snapshot.entries({ sessionId })) {
        if (keep(entry)) continue
        for (const path of entry.paths) droppedPaths.add(path)
    }
    return (await Snapshot.diff({ sessionId })).filter(file => droppedPaths.has(file.path))
}

/**
 * 撤销最近一次回退，可以连着调用好几层，直到发新消息把可撤销的层清空。
 * @param {{ sessionId: string, files?: boolean }} target files 要和回退时传的一致。
 * @returns {Promise<object>} 撤销后的完整会话，另带 restored 是被还原的文件列表。
 */
const redo = async ({ sessionId, files = true }) => {
    if (Store.agents.get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    await History.load({ sessionId })

    // 撤销回退也是对话和文件分开的两件事，和回退时一一对应。
    // 每撤销一次就退掉一层，所以可以连着撤销好几步。
    const restored = files ? await Snapshot.undo({ sessionId }) : []
    await History.redo({ sessionId })
    await History.save({ sessionId })
    const agent = Store.agents.get(sessionId)
    if (agent) agent.history = History.get({ sessionId })
    return { ...await SessionRead.read({ sessionId }), restored }
}

export default { rollback, changes, rollbackPreview, rollbackTool, toolChanges, redo }
