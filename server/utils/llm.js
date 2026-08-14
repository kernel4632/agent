/* OpenAI 兼容模型统一从这里流入 UIMessage。 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { readUIMessageStream, streamText, toUIMessageStream } from 'ai'
import { nanoid } from 'nanoid'
import Retry from './retry.js'

const stream = async (request, options = {}) => {
    let emptyAttempts = 0
    return Retry.run(async () => {
    const languageModel = createOpenAICompatible({
        name: request.provider.name,
        baseURL: request.provider.baseURL,
        apiKey: request.provider.key,
        includeUsage: true,
    }).chatModel(request.model.id)
    const result = streamText({
        model: languageModel, messages: request.messages, tools: request.tools,
        instructions: request.instructions, abortSignal: request.signal,
        maxOutputTokens: request.model.maxOutput, maxRetries: 0,
    })
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
    try { for await (const update of readUIMessageStream({ stream: observed })) message = update } catch (error) {
        if (streamed) error.streamed = true
        throw error
    }
    if (!message || !message.parts?.length) {
        emptyAttempts += 1
        throw Object.assign(new Error('Model returned no message'), { status: emptyAttempts < 3 ? 503 : 400 })
    }
    return { message, usage: await result.usage }
    }, request.signal)
}

export default { stream }
