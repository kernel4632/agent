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

const run = async ({
    messages, system, tools, llm, retry = {}, buildContext, compact, executeTool, sessionId, signal,                    // 数据、LLM 参数、功能模块和取消信号
    onStart, onLLMStart, onLLMFinish, onPermission, onLLMEvent, onRetry, onToolCall, onToolOutput, onToolResult, onCompact, // 全部回调，没传的自动跳过
}) => {
    if (!Array.isArray(messages) || !llm || typeof buildContext !== 'function' || typeof compact !== 'function') throw new TypeError('messages, llm, buildContext and compact are required')

    onStart?.()                // 外部需要时知道循环已经开始；没有回调就跳过。
    let noToolCount = 0        // 记录连续没有工具调用的模型回合。
    let temporaryPrompt = null  // 工具提示只临时发送给模型，不写入 history。

    while (true) {
        // --- 每轮开始：先响应取消信号 ---
        if (signal?.aborted) throw new DOMException('Agent loop aborted', 'AbortError')

        // --- 构建上下文，Token 超限时触发自动压缩 ---
        let context = buildContext({ history: messages, system, tools })
        while (Number.isFinite(llm.maxTokens) && context.token >= llm.maxTokens * (llm.compactThreshold ?? 0.8)) {
            const content = await compact({ messages: context.messages, llm, stream: llm.stream, onCompact, signal }) // 自动压缩只在接近上限时触发；Compact 本身不判断上下文大小。
            messages.push(Message.compact({ content }))                     // 总结写回 history，下一轮重新构建上下文。
            context = buildContext({ history: messages, system, tools })     // 重新估算 Token，还超限就继续压。
        }

        // --- 请求模型（含自动重试）---
        if (signal?.aborted) throw new DOMException('Agent loop aborted', 'AbortError')
        const result = await Retry.run({
            operation: async () => {
                const request = { messages: temporaryPrompt ? [...context.messages, Message.user({ content: temporaryPrompt })] : context.messages, tools } // 临时提示只挂在本次请求上。
                await onLLMStart?.(request)                              // 每次重试都是一次真实模型请求。
                return LLM.chat({ ...llm, ...request, signal, onLLMEvent }) // 配置和本次请求内容一起交给 LLM。
            },
            signal, onRetry, maxDelay: retry.maxDelay ?? 60, // 取消信号、重试通知和退避上限（秒）。
        })
        await onLLMFinish?.(result) // 上层拿到完整 result，自行选择 usage 或其他字段。
        temporaryPrompt = null      // 提示已经用过，下一轮默认不再携带。

        // --- 处理无工具调用的情况 ---
        const toolCalls = result.toolCalls || []                                                        // 模型这轮想调用的工具。
        const assistantMessages = result.responseMessages.filter(message => message.role === 'assistant') // 只保留 assistant 消息，保留思考和厂商内容。

        if (!toolCalls.length) {
            messages.push(...assistantMessages)                                 // 保存模型完整 assistant 消息。
            noToolCount += 1                                                    // 累计没有工具调用的轮次。
            if (noToolCount === 2) temporaryPrompt = '[错误] 你刚才的响应中没有使用工具！请继续使用工具（这是一条系统提醒消息，请勿以对话形式回复）'      // 第 2 轮：插入临时提示推一下模型。
            if (noToolCount >= 3) return { reason: 'no-tool' }  // 第 3 轮：放弃，直接返回结束原因。
            continue
        }
        noToolCount = 0 // 有工具调用，计数清零。

        // --- 逐个执行工具调用 ---
        const toolResults = [] // 先全部放临时数组，避免历史出现半截 assistant/tool 结构。
        let stop = false       // 任何工具要求停止，整个循环就结束。
        for (const call of toolCalls) {
            onToolCall?.(call) // 让上层知道即将执行哪个工具。

            // 模型已经产生了完整工具调用。即使此刻被取消，也要给它补一条取消结果。
            if (signal?.aborted) {
                toolResults.push({ call, output: { type: 'error-text', value: '工具执行已取消' } })
                stop = true
                break
            }

            const allowed = await onPermission?.({ sessionId, callId: call.toolCallId, toolCallId: call.toolCallId, toolName: call.toolName, arguments: call.input, signal }) ?? true // 没有权限回调时按无人值守模式直接放行。
            if (!allowed) {
                toolResults.push({ call, output: { type: 'execution-denied', reason: '工具执行被用户拒绝' } }) // 拒绝也是一条结果，模型需要知道。
                continue
            }

            try {
                const value = await executeTool({ name: call.toolName, input: call.input, tool: tools, signal, onOutput: output => onToolOutput?.({ ...output, ...call }) }) // 工具的实时输出原样转给上层。
                toolResults.push({ call, output: value.output })                        // 结果先入临时数组。
                onToolResult?.({ ...call, result: value, output: value.output })        // 通知上层这个工具已经执行完。
                stop ||= value?.stop === true || value?.interrupted === true            // 工具主动停止或被中断都要结束循环。
            } catch (error) {
                // 工具失败属于工具结果，不能让一次工具失败打断整个 Agent 循环。
                if (error?.name === 'AbortError') {
                    toolResults.push({ call, output: { type: 'error-text', value: '工具执行已取消' } })
                    stop = true
                    break
                }
                const output = { type: 'error-text', value: `工具执行失败：${error.message}` } // 失败信息也交给模型，让它自己决定怎么补救。
                toolResults.push({ call, output })
                onToolResult?.({ ...call, error: error.message, output })
            }
        }

        // 为中途取消、尚未执行的调用补占位结果，保证历史始终成对。
        for (const call of toolCalls.slice(toolResults.length)) toolResults.push({ call, output: { type: 'error-text', value: '工具执行已取消' } })

        // --- 把本轮消息和工具结果写回历史 ---
        messages.push(...assistantMessages) // AI SDK 的 tool 消息不用，工具结果由项目自己的执行器生成。
        for (const { call, output } of toolResults) messages.push(Message.tool({ toolCallId: call.toolCallId, toolName: call.toolName, content: output }))

        // --- 判断是否停止循环 ---
        if (stop) {
            if (signal?.aborted) throw new DOMException('Agent loop aborted', 'AbortError') // 取消导致的停止，仍然按异常向上抛。
            return { reason: 'tool-stop' }                                                  // 工具主动要求停止时，返回结束原因。
        }
    }
}

export default { run }
