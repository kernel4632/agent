/*
 * 后端唯一数据仓库。
 *
 * 导入本文件就能直接看到全部运行数据：config、agents、sessions。
 * 本文件只保存数据，不执行读写文件、业务判断或 HTTP 反馈。
 * 数据流：commands/features 直接读写 Store → 数据被保存或反馈给前端。
 */

// 当前程序使用的全局配置；首次启动时为空对象。
const config = {}

// 每个会话当前使用的 Agent 实例；key 是 sessionId。
const agents = new Map()

// 每个会话的历史记录；value 包含 messages 和 redo 两条时间线。
const sessions = new Map()

export default { config, agents, sessions }
