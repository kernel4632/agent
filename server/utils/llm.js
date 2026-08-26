/* 
目标被调用形式（绝对不可修改）：
const result = await LLM.chat({
    // --- 连接（每次传，或初始化配置后省略）---
    baseURL: "https://中转站/v1",
    apiKey: "sk-xxx",
    model: "model-name",
    protocol: "chat",//模型协议，responses、anthropic……，默认chat
    messages: [...],                // 必填
    system,

    // --- 工具（可选）---
    tools: [...],
    toolChoice: "required",
    // --- 流式与回调 ---
    stream: true,
    onChunk: (chunk) => { ... },    // 流式时每段文字回调
    // --- 控制信号 ---
    signal: abortSignal,            // 取消信号，外部随时能打断
    // --- 自定义请求头或请求体 ---
    options: {
    headers: {},                    // 额外请求头
    body: {},                        // 额外请求体
    }
}); 
 */

import { generateText, streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'

/* 协议只影响“模型怎么创建”，后面的请求和结果都由 AI SDK 统一处理。 */
const providers = {
    // chat 使用通用兼容 Provider，让自建中转站只要兼容 OpenAI Chat API 就能接入。
    chat: (settings, model) => createOpenAICompatible({ ...settings, name: 'agent' }).chatModel(model),
    responses: (settings, model) => createOpenAI(settings).responses(model),
    anthropic: (settings, model) => createAnthropic(settings).languageModel(model),
    gemini: (settings, model) => createGoogle(settings).languageModel(model),
}

/* 只保留 Agent 真正需要的五种结果；其他 AI SDK 字段不进入项目自己的接口。 */
const resultFields = [
    'text', // 模型最后给用户看的文字答案。
    'toolCalls', // 模型要求 Agent 执行的工具和工具参数。
    'finishReason', // 模型停止生成的原因，例如正常结束或要求调用工具。
    'usage', // 本次请求消耗的输入 Token、输出 Token 和总 Token。
    'warnings', // 请求成功但某些参数未被供应商支持或没有生效的提示。
]

const createModel = ({ protocol, model, baseURL, apiKey, options, cacheKey }) => {
    const settings = { apiKey, baseURL, headers: options.headers }
    const cache = cacheKey && ['chat', 'responses'].includes(protocol) ? {
        prompt_cache_key: cacheKey,
        prompt_cache_retention: '24h',
    } : {}
    const bodyOverrides = { ...cache, ...options.body }

    // OpenAI 风格协议永久携带缓存路由字段；其他自定义字段仍由用户配置覆盖。
    if (Object.keys(bodyOverrides).length) {
        settings.fetch = async (input, init) => {
            let body = init?.body
            if (typeof body === 'string') {
                try {
                    body = { ...JSON.parse(body), ...bodyOverrides }
                } catch (error) {
                    throw new TypeError('AI SDK request body is not valid JSON', { cause: error })
                }
            }
            return fetch(input, { ...init, body: body && JSON.stringify(body) })
        }
    }

    const create = providers[protocol]
    if (!create) throw new Error(`Unsupported protocol: ${protocol}`)
    return create(settings, model)
}

const resolveResult = result => Promise.all(
    resultFields.map(async field => [field, await result[field]]),
).then(Object.fromEntries)

const chat = async ({
    baseURL,
    apiKey,
    model,
    protocol = 'chat',
    system,
    messages,
    tools,
    toolChoice = 'required',
    stream = true,
    onChunk,
    signal,
    options = {},
}) => {
    if (!baseURL || !model || !Array.isArray(messages)) {
        throw new TypeError('baseURL, model and messages are required')
    }

    // 这里故意只构造一份参数，避免 generateText 和 streamText 的行为分叉。
    // 缓存键由 LLM 层统一生成，所有调用 chat 的地方都会自动使用缓存。
    const stableKey = `agent:${baseURL}:${model}:${Bun.hash(JSON.stringify(system || ''))}`
    const input = {
        model: createModel({ protocol, model, baseURL, apiKey, options, cacheKey: stableKey }),
        system,
        messages,
        tools,
        toolChoice,
        abortSignal: signal,
        onChunk,
    }

    if (!stream) return resolveResult(await generateText(input))

    // streamText 负责实时产生内容，consume 由内部完成，调用方只拿最终结果。
    const result = streamText(input)
    const text = []
    for await (const delta of result.textStream) text.push(delta)
    const output = await resolveResult(result)
    return { ...output, text: text.join('') }
}

export default { chat }
