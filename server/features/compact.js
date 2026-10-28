/*
 * 上下文压缩：把长历史总结成一段，继续留在会话里。
 *
 * 自动压缩的阈值在全局配置 config.compact.threshold；手动压缩走这个文件。
 * 压缩模型可以单独配置（config.models.compact），只换连接那一半，
 * 上下文预算仍按主模型的上下文算。
 *
 * 调用示例：
 *   const content = await Compact.run({ sessionId })
 */

import store from '../store.js'
import Agent from './agent.js'
import History from './history.js'
import SSE from '../utils/sse.js'
import fail from '../utils/fail.js'

const run = async ({ sessionId }) => {
    const session = await History.load(sessionId)
    const agent = await Agent.get({ sessionId })
    if (agent.running) throw fail(409, `Agent is already running: ${sessionId}`)
    // 模型地址没填时压缩必然失败，说清是配置问题，别报成程序错误。
    if (!agent.config.baseURL || !agent.config.model) throw fail(400, `Session has no model configured: ${sessionId}`)

    // 压缩只往历史里追加一条总结，被总结的原文仍然留在磁盘上。
    const startLength = agent.history.length
    const content = await agent.compact({ onCompact: event => SSE.send({ id: sessionId, data: event }) })
    for (const message of agent.history.slice(startLength)) await History.add({ sessionId, message })
    await History.save(sessionId)
    return content
}

// --- 当前自动压缩阈值 ---
const threshold = () => Agent.threshold()

export default { run, threshold }
