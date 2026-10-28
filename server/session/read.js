/*
 * 读取一条会话：资料、可见历史、任务清单、待审批和设置。
 *
 * 运行中的会话以 Agent 手里的历史为准，空闲时从磁盘读；界面只看到这两种状态，
 * 不需要自己判断消息该从哪里取。
 * 调用示例：
 *   const session = await SessionRead.read({ sessionId: 'session-1' })
 *   const session = await SessionRead.read({ sessionId }) // { ...meta, history, todos, running, pending, settings, undoable }
 */

import Approval from '../safety/approval.js' // 待审批的工具调用。
import Settings from '../config/settings.js' // 当前会话设置。
import { canonical } from '../tool/names.js' // 旧工具名也能认出待办工具。
import AgentSession from '../agent/create.js' // 空闲时确保 Agent 已建好。
import History from './history.js' // 空闲时从磁盘读历史。
import Meta from './meta.js' // 会话资料。
import Store from '../agent/state.js' // 运行中的 Agent 实例。

// --- 读取会话 ---
const read = async ({ sessionId }) => {
    const meta = await Meta.read(sessionId)               // 先确认会话存在，不存在时按 404 反馈。
    const agent = Store.agents.get(sessionId)            // 内存里有 Agent 时，运行中的历史以它为准。
    // 继续指令只给模型看，不能作为用户消息出现在界面上。
    const visible = history => history.filter(message => !message.internal)
    const running = Boolean(agent?.running)

    let history
    if (running) {
        // 运行中的会话以 Agent 手里的历史为准，磁盘上还没有这一轮的新消息。
        history = visible(agent.history)
    } else {
        await History.load({ sessionId })
        history = visible(History.get({ sessionId }))        // 磁盘里即使有内部提示也不能回到界面
        if (agent) agent.history = history                  // 历史被回退或外部修改过，交回 Agent 手里的必须是最新的。
        else await AgentSession.create({ sessionId, history, meta })
    }

    // 运行和空闲两种状态只差历史从哪里取，返回的字段始终是同一份。
    // todos 本来就在历史里（update_todo_list 工具的结果），这里提出来让界面不用自己翻。
    // pending 是还在等用户批准的工具；undoable 是还能撤销几次回退。
    return {
        ...meta,
        history,
        todos: latestTodos(history),
        running,
        pending: Approval.pending(sessionId),
        settings: await Settings.read({ sessionId }),     // 模式和开关，界面据此显示当前状态。
        undoable: History.redoCount({ sessionId }),
    }
}

// --- 从历史里取出最新一份任务清单 ---
const latestTodos = history => {
    // 从后往前找最后一次清单调用，用户要看的是"现在还剩什么"。
    for (const message of [...history].reverse()) {
        for (const part of Array.isArray(message.content) ? message.content : []) {
            if (part.type !== 'tool-result' || canonical(part.toolName) !== 'update_todo_list') continue
            if (part.output?.value?.items) return part.output.value.items
        }
    }
    return []
}

export default { read }
