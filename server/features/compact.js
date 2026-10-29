/*
 * 上下文压缩：把长历史总结成一段，继续留在会话里。
 *
 * 这是纯逻辑边界：调用方把已经装配好的 agent 和进度回调传进来，
 * 压缩结果直接返回；写历史、发 SSE 都由命令层做，本文件不 import 别的 feature。
 *
 * 调用示例：
 *   const content = await Compact.run({ sessionId, agent, onEvent })
 *   for (const message of agent.history.slice(start)) await History.add({ sessionId, message })
 */

import fail from '../utils/fail.js'

const run = async ({ sessionId, agent, onEvent }) => {
    if (agent.running) throw fail(409, `Agent is already running: ${sessionId}`) // 跑着的任务不能同时压缩
    // 模型地址没填时压缩必然失败，说清是配置问题，别报成程序错误。
    if (!agent.config.baseURL || !agent.config.model) throw fail(400, `Session has no model configured: ${sessionId}`)
    return agent.compact({ onCompact: onEvent })                                // agent-core 把总结追加到 agent.history
}

export default { run }
