/*
 * 上下文压缩：把长历史总结成一段，继续留在会话里。
 *
 * 这是纯逻辑边界：调用方把历史消息和连接配置传进来，
 * 压缩结果和总结消息块直接返回；写历史和 SSE 通知由命令层接手，本文件不 import 别的 feature。
 *
 * 不依赖装配好的 Agent 实例：直接调 agent-core 的静态 Agent.context.build 裁剪上下文，
 * 再用 Agent.compact.run 发压缩请求。调用方只需提供纯历史消息和连接配置。
 *
 * 调用示例：
 *   const history = records.map(({ messageId, ...message }) => message)
 *   const llm = Agent.connection(session.model)
 *   const { content, message } = await Compact.run({ sessionId, history, llm, onEvent })
 *   await History.add({ sessionId, message })
 */

import Agent from '@kernel4632/agent-core'
import fail from '../utils/fail.js'

const run = async ({ sessionId, history, llm, system = '', onEvent }) => {
    if (!history?.length) throw fail(400, `No messages to compact: ${sessionId}`)
    if (!llm?.baseURL || !llm?.model) throw fail(400, `Session has no model configured: ${sessionId}`)
    const { messages } = Agent.context.build({ history, system })
    const { content, usage } = await Agent.compact.run({ messages, llm, stream: llm.stream !== false, onCompact: onEvent })
    const message = Agent.history.compact({ content })    // agent-core 的 compact 消息块，可直接写进 History
    return { content, usage, message }
}

export default { run }
