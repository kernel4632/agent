/*
 * 测试用的 Agent 装配辅助：取 Agent、收尾回收、走审批关口。
 *
 * commands/ 里的文件之间不互相 import，装配写在 chat.js 和 session.js 各自的文件里；
 * 测试要直接取 Agent 或调审批时，在这里按同样的方式取齐材料。
 *
 * 调用示例：
 *   const agent = await getAgent(sessionId)
 *   await settleAgent(sessionId)
 *   const allowed = await checkPermission({ sessionId, toolCallId: 'c1', toolName: 'read_file', input: {} })
 */

import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import Context from '../features/context.js'
import History from '../features/history.js'
import Mcp from '../features/mcp.js'
import Review from '../features/review.js'
import Tool from '../features/tool.js'

// --- 审批关口：快照、扫描和类别查询由这里递给审批 ---
const checkPermission = params => Approval.check({
    ...params,
    snapshot: Tool.snapshot,        // 放行时让工具自己决定存不存快照
    ready: Tool.ready,              // 工具表没扫描过时先补一次
    kindOf: Tool.kind,            // 查这个工具属于哪一类
    review: Review.check,         // 权限动作为 review 时先问审核器
})

// --- 装配一条会话的 Agent 要用的全部材料 ---
const agentMaterials = async sessionId => {
    const session = await History.load(sessionId)                 // 会话元数据和历史先读进内存
    const saveSession = () => History.save(sessionId)             // 工具改了会话后能立刻落盘
    const built = await Tool.build({ sessionId, onPermission: checkPermission, saveSession, mcp: Mcp }) // 工具表和 MCP 租约
    return { session, settings: Agent.settings(session), ...built, onPermission: checkPermission, saveSession, context: Context }
}

// --- 取回缓存的 Agent，没有或已过期就按最新材料装配 ---
const getAgent = sessionId => Agent.get({
    sessionId,
    assemble: {
        peek: async () => ({ session: await History.load(sessionId), context: Context }), // 先只读元数据判断缓存还能不能用
        build: () => agentMaterials(sessionId),                                          // 要重建时才真的取材料
        mcpRevision: () => Tool.revision(Mcp),                                        // 当前 MCP 配置版本
        getHistory: id => History.get({ sessionId: id }),                                // 已存的历史
    },
})

// --- 一轮结束后回收已经过期的 Agent ---
const settleAgent = sessionId => Agent.settle(sessionId, Tool.revision(Mcp))

export { getAgent, settleAgent, checkPermission }
