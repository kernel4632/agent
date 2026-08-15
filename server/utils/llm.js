/* OpenAI 兼容模型统一从这里流入 UIMessage。 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible' // 适配所有 OpenAI 协议模型。
import { dynamicTool, jsonSchema, readUIMessageStream, streamText, toUIMessageStream } from 'ai' // 处理流和 UI 消息。
import { nanoid } from 'nanoid' // 为流式助手消息生成 ID。
import Retry from './retry.js' // 统一处理模型的临时网络失败。

const stream = async (request, options = {}) => {
    let emptyAttempts = 0 // 连续空响应三次后视为永久异常。
    return Retry.run(async () => {
        // 原始 JSON Schema 在调用 AI SDK 前统一转换。
        const tools = Object.fromEntries(Object.values(request.tools || {}).map(tool => {
            const definition = {
                description: tool.description,
                inputSchema: jsonSchema(tool.inputSchema),
            }
            if (tool.toModelOutput) { // MCP 等工具可把输出转为模型媒体内容。
                definition.toModelOutput = ({ output }) => tool.toModelOutput(output)
            }
            return [tool.name, dynamicTool(definition)]
        }))

        const languageModel = createOpenAICompatible({ // 为本次提供商创建隔离客户端。
            name: request.provider.name,
            baseURL: request.provider.baseURL,
            apiKey: request.provider.key,
            includeUsage: true, // 请求模型返回 token 用量。
            transformRequestBody: body => ({ ...body, ...request.extraBody }), // 注入 web_search 等原生字段。
        }).chatModel(request.model.id)
        const result = streamText({
            model: languageModel, messages: request.messages, tools,
            instructions: request.instructions, abortSignal: request.signal,
            maxOutputTokens: request.model.maxOutput, maxRetries: 0,
            providerOptions: request.providerOptions,
        })

        // 每个增量先交给调用方，再合成为最终 UIMessage。
        let streamed = false // 一旦发送增量就不能从头重试。
        const observed = toUIMessageStream({
            stream: result.stream, tools: request.tools, generateMessageId: nanoid,
            sendReasoning: true, sendSources: true,
        }).pipeThrough(new TransformStream({
            async transform(part, controller) {
                streamed = true // 标记页面已经可能看到本次响应。
                await options.receive?.(part) // 先交给 SSE 与插件。
                controller.enqueue(part) // 再交给 UIMessage 聚合器。
            },
        }))
        let message
        try {
            for await (const update of readUIMessageStream({ stream: observed })) message = update
        } catch (error) {
            if (streamed) error.streamed = true // 重试器据此避免重复流。
            throw error // 保留 AI SDK 的原始错误。
        }

        // 空响应先按临时错误重试，连续出现后按永久错误停止。
        if (!message || !message.parts?.length) {
            emptyAttempts += 1 // 连续空消息计入临时失败次数。
            const status = emptyAttempts < 3 ? 503 : 400 // 前两次重试，第三次停止。
            throw Object.assign(new Error('Model returned no message'), { status })
        }
        try {
            return { message, usage: await result.usage } // 返回完整消息和提供商 token 用量。
        } catch (error) {
            if (streamed) error.streamed = true
            throw error
        }
    }, request.signal)
}

export default { stream } // 暴露唯一的模型流入口。
