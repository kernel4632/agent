/* 唯一 Agent 循环：上下文 -> 模型 -> 并行工具 -> 下一轮模型。 */
import { getToolName, isToolUIPart } from 'ai' // 识别 AI SDK 的动态工具消息 part。
import Store from '../store.js' // 读写会话、运行态和实时事件。
import LLM from '../utils/llm.js' // 发起统一的流式模型请求。
import Retry from '../utils/retry.js' // 给工具提供同一套无限重试策略。
import Tool from '../utils/tool.js' // 执行当前上下文中的工具快照。
import Context from './context.js' // 组装本轮模型可见消息和工具。
import Permission from './permission.js' // 在工具执行前应用审批规则。
import Checkpoint from './checkpoint.js' // 在文件变更前记录恢复点。
import Plugin from './plugin.js' // 在业务节点触发扩展钩子。

const run = async sessionID => {
    const session = Store.sessions[sessionID], runtime = Store.runtimes[sessionID] // 固定本轮会话与运行身份。
    const provider = Store.config.providers.find(item => item.name === session.provider) // 找到会话提供商。
    const model = provider?.models.find(item => item.id === session.model) // 找到会话选定模型。
    const signal = runtime.abortController.signal // 后续每一步共用同一个取消信号。
    let idle = 0, reason = 'idle' // 记录连续纯文本轮数和最终结束原因。

    try {
        if (!provider || !model) throw new Error('Session model is not configured') // 无模型时不进入循环。
        await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'running' } }) // 通知页面开始。
        await Plugin.emit('loop.start', { sessionID }) // 让插件准备本轮扩展行为。

        while (!signal.aborted) {
            // 达到阈值时追加摘要，原始消息仍完整保存在 JSONL。
            const latestSummary = session.messages.findLastIndex(message => message.summary) // 定位最近摘要。
            if ((latestSummary < 0 || latestSummary < session.messages.length - 3)
                && Context.count(session.messages) > model.contextWindow * Store.config.context.compactRatio) {
                const context = await Context.build(sessionID) // 摘要也使用当前可见上下文。
                const result = await LLM.stream({
                    provider, model, ...context, instructions: Store.config.prompts.summary, signal,
                })
                const summary = { ...result.message, summary: true, usage: result.usage } // 标记特殊摘要消息。
                session.messages.push(summary) // 只追加摘要，不删除原始历史。
                await Store.save(sessionID) // 摘要立即写回 JSONL。
                await Plugin.emit('message.append', { sessionID, message: summary }) // 通知标题等消息插件。
                await Store.broadcast(sessionID, { type: 'data-compact', data: { message: summary } })
            }

            // 模型增量同时进入 SSE 缓存和插件钩子。
            const context = await Context.build(sessionID) // 为普通模型轮次重建最新上下文。
            const request = await Plugin.emit('request.before', { sessionID, ...context }) // 允许插件调整请求。
            const result = await LLM.stream({ provider, model, ...request, signal }, {
                receive: part => Promise.all([Store.broadcast(sessionID, part),
                    Plugin.emit('part.stream', { sessionID, part })]),
            })
            const message = { ...result.message, usage: result.usage } // 把 token 用量附在助手消息上。
            session.messages.push(message) // 新助手消息成为后续工具结果载体。
            await Store.save(sessionID) // 模型结果先落盘再执行工具。
            await Store.broadcast(sessionID, { type: 'data-message', data: { message } })

            // 一条助手消息中的所有工具调用并行等待审批和执行。
            const stopped = (await Promise.all(message.parts.map(async (part, partIndex) => {
                if (!isToolUIPart(part) || part.state !== 'input-available') return false // 跳过普通文本和已完成工具。
                const name = getToolName(part) // 从动态 part 类型还原工具名。
                try {
                    const allowed = await Permission.request(sessionID, part.toolCallId, name, part.input) // 等待审批。
                    if (!allowed) {
                        Object.assign(part, { state: 'output-denied' }) // 把拒绝结果写回原工具 part。
                        await Store.broadcast(sessionID, { type: 'tool-output-denied', toolCallId: part.toolCallId })
                        return false // 拒绝不会停止整个 Agent 循环。
                    }
                    // 插件可以在工具执行前替换模型给出的输入。
                    const before = await Plugin.emit('tool.before', { sessionID, tool: name, input: part.input }) // 改参
                    const output = await Tool.execute(name, before.input, {
                        sessionID, messageID: message.id, partIndex, signal, tools: context.tools,
                        receive: event => Store.broadcast(sessionID, {
                            type: 'data-tool-output', data: { callID: part.toolCallId, tool: name, ...event },
                        }),
                        checkpoint: path => Checkpoint.save(sessionID, { messageID: message.id, partIndex }, path),
                        retry: operation => Retry.run(operation, signal), // 工具可复用统一退避规则。
                    })
                    Object.assign(part, { state: 'output-available', output: output.output }) // 结果进入消息真相。
                    await Store.broadcast(sessionID, {
                        type: 'tool-output-available', toolCallId: part.toolCallId, output: output.output,
                    })
                    await Plugin.emit('tool.after', {
                        sessionID, tool: name, input: before.input, output: output.output,
                    })
                    return output.stop === true // finish/ask_user 可以结束循环。
                } catch (error) {
                    Object.assign(part, { state: 'output-error', errorText: String(error) }) // 错误也进入消息历史。
                    await Store.broadcast(sessionID, {
                        type: 'tool-output-error', toolCallId: part.toolCallId, errorText: String(error),
                    })
                } finally {
                    await Store.save(sessionID) // 无论成功、拒绝或失败都保存最终 part 状态。
                }
            }))).some(Boolean)
            idle = message.parts.some(isToolUIPart) ? 0 : idle + 1 // 工具轮会重置纯文本空转计数。
            await Plugin.emit('message.append', { sessionID, message }) // 完整消息就绪后通知插件。

            if (stopped) {
                reason = 'tool' // 记录是工具主动要求结束。
                break // 不再发起下一轮模型请求。
            }
            if (Store.config.context.idleRounds > 0 && idle >= Store.config.context.idleRounds) break
        }
        if (signal.aborted) reason = 'abort' // 用户停止优先于普通 idle 原因。
    } catch (error) {
        reason = signal.aborted ? 'abort' : 'error' // 区分主动取消和真实失败。
        if (reason === 'error') await Store.broadcast(sessionID, { type: 'error', errorText: String(error) })
    } finally {
        await Plugin.emit('loop.end', { sessionID, reason }).catch(() => {}) // 收尾插件不能阻止状态归还。
        if (Store.runtimes[sessionID] === runtime && runtime.abortController.signal === signal) {
            runtime.status = 'idle' // 只有当前控制器可以结束当前运行。
            await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason } })
        }
    }
}

export default { run } // 只导出唯一 Agent 循环入口。
