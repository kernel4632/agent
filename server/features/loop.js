/* 
目标被调用形式（绝对不可修改）：
const result = await Loop.run({
    // --- 数据（必填）---
    messages: [],               // 完整消息列表
    system: "你是编程助手",         // 系统提示词
    tools: [],                  // 工具列表
    toolPrompt: "必须使用工具继续完成任务", // 模型连续不调用工具时临时提醒

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
    compressContext: Compact.run,     // 上下文压缩模块
    executeTool: Tool.execute,             // 工具执行模块
    sessionId: "session-1",               // 压缩和工具输出使用的会话

    // --- 控制（可选）---
    signal: abortSignal,           // 取消信号

    // --- 回调（全部可选）---
    onStart: () => { },                    // 循环开始
    onText: (text) => { },                 // 流式文字增量
    onRetry: (info) => { },                // 请求失败重试中
    onPermission: async (permission) => { }, // 工具权限询问，返回三态决定
    onToolResult: (result) => { },         // 工具执行完
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
    toolPrompt,
    llm,
    retry = {},
    buildContext,
    compressContext,
    executeTool,
    sessionId,
    signal,
    onStart,
    onPermission,
    onText,
    onRetry,
    onToolCall,
    onToolOutput,
    onToolResult,
}) => {
    if (!Array.isArray(messages) || !llm || typeof buildContext !== 'function' || typeof compressContext !== 'function') {
        throw new TypeError('messages, llm, buildContext and compressContext are required')
    }

    onStart?.()
    let noToolCount = 0
    let temporaryPrompt = null

    while (true) {
        checkCancelled(signal)

        // Compact 每次都会被调用。未超限时它原样返回，Loop 就离开这个小循环。
        let context = buildContext({ history: messages })
        while (true) {
            const compacted = await compressContext({
                sessionId,
                messages: context.messages,
                token: context.token,
                maxTokens: llm.maxTokens,
            })

            if (compacted.messages === context.messages) {
                context = compacted
                break
            }

            messages.push(...compacted.messages)
            context = buildContext({ history: messages })
        }

        checkCancelled(signal)
        const text = []
        const result = await Retry.run({
            operation: () => LLM.chat({
                ...llm,
                system,
                messages: temporaryPrompt
                    ? [...context.messages, Message.user({ content: temporaryPrompt })]
                    : context.messages,
                tools,
                signal,
                onChunk: ({ chunk }) => {
                    if (chunk?.type !== 'text-delta') return
                    const delta = chunk.text ?? chunk.textDelta ?? chunk.delta
                    if (!delta) return
                    text.push(delta)
                    onText?.(delta)
                },
            }),
            signal,
            onRetry,
            maxDelay: retry.maxDelay ?? 60,
        })
        temporaryPrompt = null

        const toolCalls = result.toolCalls || []
        if (!toolCalls.length) {
            const assistant = Message.assistant({ content: text.join('') || result.text || null })
            messages.push(assistant)
            noToolCount += 1

            // 第一次不调用工具继续请求；第二次加入临时工具提示；第三次才认定模型不会调用工具。
            if (noToolCount === 2) {
                if (typeof toolPrompt !== 'string' || !toolPrompt.trim()) {
                    throw new Error('config.prompt.tool must be a non-empty string')
                }
                temporaryPrompt = toolPrompt
            }
            if (noToolCount >= 3) return { ...result, text: text.join('') || result.text || '' }
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

            const decision = await onPermission?.({
                sessionId,
                callId: call.toolCallId,
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                arguments: call.input,
                signal,
            }) ?? 'allow-always'

            if (decision === 'deny') {
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

        messages.push(Message.assistant({
            content: text.join('') || result.text || null,
            toolCalls: toolCalls.map(call => ({
                id: call.toolCallId,
                name: call.toolName,
                arguments: JSON.stringify(call.input),
            })),
        }))
        for (const { call, output } of toolResults) {
            messages.push(Message.tool({
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                content: output,
            }))
        }

        if (stop) {
            const finished = { ...result, text: text.join('') || result.text || '', stop: true }
            if (signal?.aborted) throw new DOMException('Agent loop aborted', 'AbortError')
            return finished
        }
    }
}

export default { run }
