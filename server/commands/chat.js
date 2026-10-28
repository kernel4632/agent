/*
 * 对话指令：发送、继续、停止和审批决定。
 *
 * 这几个动作都直接对应一次运行；模型输出和工具过程通过 SSE 推给界面。
 * 调用示例：
 *   await Chat.send({ sessionId, input: '你好' })
 *   await Chat.resume({ sessionId })
 *   await Chat.stop({ sessionId })
 *   await Chat.decide({ sessionId, toolCallId, decision: 'allow-once' })
 */

import Approval from '../features/approval.js'
import Run from '../features/run.js'

const send = input => Run.send(input)
const resume = input => Run.resume(input)
const stop = input => Run.stop(input)
const decide = input => Approval.decide(input)

export default { send, resume, stop, decide }
