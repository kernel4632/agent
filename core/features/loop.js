/* 
目标被调用形式（绝对不可修改）：
const result = await Loop.run({
    // --- 数据（必填）---
    messages: [],               // 完整消息列表
    system: "你是编程助手",         // 系统提示词
    tools: [],                  // 工具列表

    // --- LLM 参数（必填，内部传给 LLM.chat）---
    llm: {
        // 连接
        baseURL: "https://中转站/v1",
        apiKey: "sk-xxx",
        model: "model-name",
        protocol: "chat",          // chat / responses / anthropic
        // 参数覆盖
        options: {
            headers: {},
            body: {},
        },
    },
    retry: {
        maxDelay: 60000,
    },
    // --- 功能模块（必填，平齐的功能模块作为参数传）---
    buildContext: Context.build,       // 上下文构建模块
    compact: Compact.run,             // 上下文压缩模块
    executeTool: Tool.execute,             // 工具执行模块
    sessionId: "session-1",               // 压缩和工具输出使用的会话

    // --- 控制（可选）---
    signal: abortSignal,           // 取消信号

    // --- 回调（全部可选）---
    onStart: () => { },                    // 循环开始
    onLLMStart: (request) => { },          // 每次实际请求模型前
    onLLMFinish: (result) => { },          // 本次模型请求完成，返回完整 result
    onLLMEvent: event => {},               // 原样接收 AI SDK 的所有流事件
    onRetry: (info) => { },                // 请求失败重试中
    onPermission: async (permission) => { }, // 工具权限询问，返回 true 或 false
    onToolResult: (result) => { },         // 工具执行完
    onCompact: (event) => { },             // 压缩过程通知
 })
 */

import Message from '../utils/message.js'
import Retry from '../utils/retry.js'
import LLM from '../utils/llm.js'

const checkCancelled = signal => {
    if (signal?.aborted) throw new DOMException('Agent loop aborted', 'AbortError')
}

const run = async ({
    messages,
    system,
    tools,
    llm,
    retry = {},
    buildContext,
    compact,
    executeTool,
    sessionId,
    signal,
    onStart,
    onLLMStart,
    onLLMFinish,
    onPermission,
    onLLMEvent,
    onRetry,
    onToolCall,
    onToolOutput,
    onToolResult,
    onCompact,
}) => {
    if (!Array.isArray(messages) || !llm || typeof buildContext !== 'function' || typeof compact !== 'function') {
        throw new TypeError('messages, llm, buildContext and compact are required')
    }

    onStart?.() // 外部需要时知道循环已经开始；没有回调就跳过。
    let noToolCount = 0 // 记录连续没有工具调用的模型回合。
    let temporaryPrompt = null // 工具提示只临时发送给模型，不写入 history。

    while (true) {
        checkCancelled(signal) // 每一轮开始先响应外部 stop。

        // 先把 system、历史和工具一起交给 Context，得到接近真实请求的 Token 估算。
        let context = buildContext({ history: messages, system, tools })
        while (Number.isFinite(llm.maxTokens) && context.token >= llm.maxTokens * (llm.compactThreshold ?? 0.8)) {
            // 自动压缩只在接近上限时触发；Compact 本身不判断上下文大小。
            const content = await compact({
                messages: context.messages,
                llm,
                stream: llm.stream,
                onCompact,
                signal,
            })
            messages.push(Message.compact({ content })) // 总结写回 history，下一轮重新构建上下文。
            context = buildContext({ history: messages, system, tools })
        }

        checkCancelled(signal)
        const result = await Retry.run({
            operation: async () => {
                const request = {
                    messages: temporaryPrompt
                        ? [...context.messages, Message.user({ content: temporaryPrompt })]
                        : context.messages,
                    tools,
                }
                await onLLMStart?.(request) // 每次重试都是一次真实模型请求。
                return LLM.chat({
                    ...llm,
                    ...request,
                    signal,
                    onLLMEvent,
                })
            },
            signal,
            onRetry,
            maxDelay: retry.maxDelay ?? 60,
        })
        await onLLMFinish?.(result) // 上层拿到完整 result，自行选择 usage 或其他字段。
        temporaryPrompt = null

        const toolCalls = result.toolCalls || []
        const assistantMessages = result.responseMessages.filter(message => message.role === 'assistant')
        if (!toolCalls.length) {
            messages.push(...assistantMessages) // 只保存模型完整 assistant 消息，保留思考和厂商内容。
            noToolCount += 1 // 没有工具时增加计数，决定是否继续提醒模型。

            // 第一次不调用工具继续请求；第二次加入临时工具提示；第三次才认定模型不会调用工具。
            if (noToolCount === 2) {
                temporaryPrompt = '请继续使用工具完成任务。' // 内置提示词不进入 history，只影响下一次请求。
            }
            if (noToolCount >= 3) return { ...result, text: result.text || '' }
            continue
        }
        noToolCount = 0

        // 工具回合先全部放在临时数组中，避免历史出现半截 assistant/tool 结构。
        const toolResults = []
        let stop = false
        for (const call of toolCalls) {
            onToolCall?.(call)

            // 模型已经产生了完整工具调用。即使此刻被取消，也要给它补一条取消结果。
            if (signal?.aborted) {
                toolResults.push({ call, output: { type: 'error-text', value: '工具执行已取消' } })
                stop = true
                break
            }

            const allowed = await onPermission?.({
                sessionId,
                callId: call.toolCallId,
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                arguments: call.input,
                signal,
            }) ?? true // 没有权限回调时按无人值守模式直接放行。

            if (!allowed) {
                toolResults.push({ call, output: { type: 'execution-denied', reason: '工具执行被用户拒绝' } })
                continue
            }

            try {
                const value = await executeTool({
                    name: call.toolName,
                    input: call.input,
                    tool: tools,
                    signal,
                    onOutput: output => onToolOutput?.({ ...output, ...call }),
                })
                toolResults.push({ call, output: value.output })
                onToolResult?.({ ...call, result: value, output: value.output })
                stop ||= value?.stop === true || value?.interrupted === true
            } catch (error) {
                // 工具失败属于工具结果，不能让一次工具失败打断整个 Agent 循环。
                if (error?.name === 'AbortError') {
                    toolResults.push({ call, output: { type: 'error-text', value: '工具执行已取消' } })
                    stop = true
                    break
                }
                const output = { type: 'error-text', value: `工具执行失败：${error.message}` }
                toolResults.push({ call, output })
                onToolResult?.({ ...call, error: error.message, output })
            }
        }

        // 取消时也为尚未执行的调用补一条结果，保证历史始终成对。
        for (const call of toolCalls.slice(toolResults.length)) {
            toolResults.push({ call, output: { type: 'error-text', value: '工具执行已取消' } })
        }

        messages.push(...assistantMessages) // AI SDK 的 tool 消息不用，工具结果由项目自己的执行器生成。
        for (const { call, output } of toolResults) {
            messages.push(Message.tool({ toolCallId: call.toolCallId, toolName: call.toolName, content: output }))
        }

        if (stop) {
            const finished = { ...result, text: result.text || '', stop: true }
            if (signal?.aborted) throw new DOMException('Agent loop aborted', 'AbortError')
            return finished
        }
    }
}

export default { run }
