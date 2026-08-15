/* OpenAI 兼容模型统一从这里流入 UIMessage。 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { dynamicTool, jsonSchema, readUIMessageStream, streamText, toUIMessageStream } from 'ai'
import { nanoid } from 'nanoid'
import Retry from './retry.js'

const stream = async (request, options = {}) => {
    let emptyAttempts = 0
    return Retry.run(async () => {
        // 原始 JSON Schema 在调用 AI SDK 前统一转换。
        const tools = Object.fromEntries(Object.values(request.tools || {}).map(tool => {
            const definition = {
                description: tool.description,
                inputSchema: jsonSchema(tool.inputSchema),
            }
            if (tool.toModelOutput) {
                definition.toModelOutput = ({ output }) => tool.toModelOutput(output)
            }
            return [tool.name, dynamicTool(definition)]
        }))

        const languageModel = createOpenAICompatible({
            name: request.provider.name,
            baseURL: request.provider.baseURL,
            apiKey: request.provider.key,
            includeUsage: true,
            transformRequestBody: body => ({ ...body, ...request.extraBody }),
        }).chatModel(request.model.id)
        const result = streamText({
            model: languageModel, messages: request.messages, tools,
            instructions: request.instructions, abortSignal: request.signal,
            maxOutputTokens: request.model.maxOutput, maxRetries: 0,
            providerOptions: request.providerOptions,
        })

        // 每个增量先交给调用方，再合成为最终 UIMessage。
        let streamed = false
        const observed = toUIMessageStream({
            stream: result.stream, tools: request.tools, generateMessageId: nanoid,
            sendReasoning: true, sendSources: true,
        }).pipeThrough(new TransformStream({
            async transform(part, controller) {
                streamed = true
                await options.receive?.(part)
                controller.enqueue(part)
            },
        }))
        let message
        try {
            for await (const update of readUIMessageStream({ stream: observed })) message = update
        } catch (error) {
            if (streamed) error.streamed = true
            throw error
        }

        // 空响应先按临时错误重试，连续出现后按永久错误停止。
        if (!message || !message.parts?.length) {
            emptyAttempts += 1
            const status = emptyAttempts < 3 ? 503 : 400
            throw Object.assign(new Error('Model returned no message'), { status })
        }
        try {
            return { message, usage: await result.usage }
        } catch (error) {
            if (streamed) error.streamed = true
            throw error
        }
    }, request.signal)
}

export default { stream }
