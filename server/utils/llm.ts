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
import pRetry from 'p-retry'
import type { ConfigData, ModelConfig, ProviderConfig } from '../types.ts'
import Error from './error.ts'
const chat = async ({
    provider,
    model,
    retry,
    messages,
    tools = {},
    instructions,
}: {
    provider: ProviderConfig
    model: ModelConfig
    retry: ConfigData['retry']
    messages: ModelMessage[]
    tools?: ToolSet
    instructions: string
}, {
    signal = new AbortController().signal,
    receive,
}: {
    signal?: AbortSignal
    receive?: (part: UIMessageChunk) => void | Promise<void>
} = {}) => {
    const languageModel = createOpenAICompatible({
        name: provider.name,
        baseURL: provider.baseURL,
        apiKey: provider.key,
        includeUsage: true,
    }).chatModel(model.id)
    let streamed = false
    let emptyAttempts = 0
    return pRetry(async () => {
                let produced = false
                const pending: UIMessageChunk[] = []
                const messageID = nanoid()
                const result = streamText({
                    model: languageModel,
                    instructions,
                    messages,
                    tools,
                    abortSignal: signal,
                    maxRetries: 0,
                    maxOutputTokens: model.maxOutput,
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
                                await receive?.(buffered)
                                controller.enqueue(buffered)
                            }
                            pending.length = 0
                            return
                        }
                        await receive?.(chunk)
                        controller.enqueue(chunk)
                    },
                }))
                for await (const update of readUIMessageStream({ stream: observed })) message = update
                if (!message || !produced) throw new NoOutputGeneratedError()
                return { message, usage: await result.usage }
            }, {
                retries: Infinity,
                factor: retry.factor,
                minTimeout: retry.baseDelay,
                maxTimeout: retry.maxDelay,
                signal,
                shouldRetry: ({ error }) => {
                    if (streamed) return false
                    if (NoOutputGeneratedError.isInstance(error)) return ++emptyAttempts < 3
                    return Error.retryable(error)
                },
            })
}
export default { chat }
