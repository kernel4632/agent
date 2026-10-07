/*
 * 后端唯一数据仓库。
 * 导入本文件就能直接看到全部运行数据：config、agents、sessions、snapshots、approvals。
 * 本文件只保存数据，不执行读写文件、业务判断或 HTTP 反馈。
 * 调用示例：
 *   Store.config.permission            // 工具权限规则
 *   Store.agents.get(sessionId)        // 这个会话正在使用的 Agent
 *   Store.sessions.get(sessionId)      // 这个会话的历史消息
 *   Store.snapshots.get(sessionId)     // 这个会话的文件快照清单
 *   Store.approvals.get(`${sessionId}:${toolCallId}`)  // 等待用户决定的工具审批
 */

// 当前程序使用的全局配置；首次启动时为空对象，工具权限规则在 config.permission。
const config = {}

// 每个会话当前使用的 Agent 实例；key 是 sessionId。
const agents = new Map()

// 每个会话的历史记录；value 包含 messages 和 redo 两条时间线。
const sessions = new Map()

// 每个会话的文件快照清单；value 是 { checkpoints: [{ messageId, files }] }。
const snapshots = new Map()

// 正在等待用户决定的工具审批；key 是 `${sessionId}:${toolCallId}`，value 里带着唤醒 Agent 的 resolve。
const approvals = new Map()

export default { config, agents, sessions, snapshots, approvals }
