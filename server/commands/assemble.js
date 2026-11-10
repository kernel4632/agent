/*
 * 装配指令：把历史、工具、审批、上下文取齐，交给 features/agent.js 建出或取回一条会话的 Agent。
 *
 * features 之间不互相调用：Agent 要用的历史、工具表、审批和上下文，都由这一层取好再递过去。
 * chat.js 和 session.js 都要装配 Agent，所以这件事单独放在这里，一处写、两处用。
 *
 * 调用示例：
 *   const agent = await Assemble.get({ sessionId })      // 取回缓存的 Agent，没有就装配一个
 *   await Assemble.create({ sessionId })                 // 按最新材料建出并缓存一个新的 Agent
 *   await Assemble.settle(sessionId)                     // 一轮结束后回收已经过期的 Agent
 *   const allowed = await Assemble.check({ sessionId, toolCallId, toolName, input, signal })
 */

import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import Context from '../features/context.js'
import History from '../features/history.js'
import Mcp from '../features/mcp.js'
import Skills from '../features/skills.js'
import Tool from '../features/tool.js'

// --- 工具执行前的审批关口：审批不认识工具表，快照、扫描和类别查询由这里递给它 ---
const check = params => Approval.check({
    ...params,
    snapshot: Tool.snapshot,                                  // 放行时让工具自己决定存不存文件快照
    ready: Tool.ready,                                        // 工具表还没扫描过时先补一次
    kindOf: Tool.kindOf,                                      // 查这个工具属于哪一类
})

// --- 装配一条会话的 Agent 要用的全部材料 ---
const materials = async sessionId => {
    const session = await History.load(sessionId)             // 会话元数据和历史先读进内存
    const saveSession = () => History.save(sessionId)         // 工具改了会话（比如 cwd）后能立刻落盘
    const built = await Tool.build({
        sessionId,
        onPermission: check,                                  // 工具执行前回到同一个审批关口
        saveSession,
        mcp: Mcp,                                             // 工具表要带上外部服务的工具
        skills: Skills,                                       // 以及技能清单
    })
    return {
        session,
        settings: Agent.readSettings(session),                // 这条会话自己的思考强度
        ...built,                                             // tools、mcpRevision、release
        onPermission: check,
        saveSession,
        context: Context,
    }
}

// --- 给 Agent.get 的取材入口：先只读元数据判断缓存还能不能用，要重建时才真的取材料 ---
const source = sessionId => ({
    peek: async () => ({ session: await History.load(sessionId), context: Context }),
    build: () => materials(sessionId),
    mcpRevision: () => Tool.mcpRevision(Mcp),
    getHistory: id => History.get({ sessionId: id }),
})

const get = ({ sessionId }) => Agent.get({ sessionId, assemble: source(sessionId) })
const create = async ({ sessionId }) => Agent.create({ sessionId, ...await materials(sessionId) })
const settle = sessionId => Agent.settle(sessionId, Tool.mcpRevision(Mcp))

export default { get, create, settle, check }
