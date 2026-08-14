/*
模型调用：用 AI SDK 对任意 OpenAI 兼容端点执行单轮流式生成，并组装标准 UIMessage。
一次调用包含完整流消费，因此网络中断会由 Retry 原地重试，不会留下半条持久消息。
*/
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
    readUIMessageStream,
    NoOutputGeneratedError,
    streamText,
    toUIMessageStream,
    type ModelMessage,
    type ToolSet,
    type UIMessage,
    type UIMessageChunk,
} from 'ai'
import { nanoid } from 'nanoid'
import Retry from './retry.ts'
import Store from '../store.ts'

const chat = async ({
    provider,
    modelID,
    messages,
    tools = {},
    instructions,
    signal,
    onPart,
}: {
    provider: string
    modelID: string
    messages: ModelMessage[]
    tools?: ToolSet
    instructions: string
    signal?: AbortSignal
    onPart?: (part: UIMessageChunk) => void | Promise<void>
}) => {
    const providerConfig = Store.config.providers.find(item => item.name === provider)
    if (!providerConfig) throw new Error(`Provider not found: ${provider}`)
    const modelConfig = providerConfig.models.find(item => item.id === modelID)
    if (!modelConfig) throw new Error(`Model not found: ${provider}/${modelID}`)
    const model = createOpenAICompatible({
        name: providerConfig.name,
        baseURL: providerConfig.baseURL,
        apiKey: providerConfig.key,
        includeUsage: true,
    }).chatModel(modelID)
    let streamed = false
    let emptyAttempts = 0
    while (true) {
        let produced = false
        const pending: UIMessageChunk[] = []
        try {
            return await Retry.run(async () => {
                const messageID = nanoid()
                const result = streamText({
                    model,
                    instructions,
                    messages,
                    tools,
                    abortSignal: signal,
                    maxRetries: 0,
                    maxOutputTokens: modelConfig.maxOutput,
                })

                let message: UIMessage | undefined
                const uiStream = toUIMessageStream({
                    stream: result.stream,
                    tools,
                    generateMessageId: () => messageID,
                    sendReasoning: true,
                    sendSources: true,
                })
                const observed = uiStream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
                    async transform(chunk, controller) {
                        if (!produced) {
                            pending.push(chunk)
                            if (!['text-delta', 'reasoning-delta', 'tool-input-available', 'tool-input-error', 'source-url', 'source-document', 'file'].includes(chunk.type)) return
                            produced = true
                            streamed = true
                            for (const buffered of pending) {
                                await onPart?.(buffered)
                                controller.enqueue(buffered)
                            }
                            pending.length = 0
                            return
                        }
                        await onPart?.(chunk)
                        controller.enqueue(chunk)
                    },
                }))
                for await (const update of readUIMessageStream({ stream: observed })) message = update
                if (!message || !produced) throw new NoOutputGeneratedError()
                return { message, usage: await result.usage, finishReason: await result.finishReason }
            }, signal, error => !streamed && Retry.recoverable(error))
        } catch (error) {
            if (streamed || !NoOutputGeneratedError.isInstance(error) || ++emptyAttempts >= 3) throw error
        }
    }
}

export default { chat }
