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
    onLLMEvent: event => {},        // 流式时原样接收 AI SDK 的每个事件
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

const chat = async ({
    baseURL, apiKey, model, protocol = 'chat', system, messages, tools, toolChoice = 'required', stream = true, onLLMEvent, signal, options = {},
}) => {
    // --- 检查输入 ---
    if (!baseURL || !model || !Array.isArray(messages)) throw new TypeError('baseURL, model and messages are required') // 没有地址、模型或消息就无法请求。

    // --- 从 messages 中取出系统提示词 ---
    const systemMessage = messages.find(message => message.role === 'system') // Context 可能已经把 system 放进 messages。
    const modelMessages = messages.filter(message => message.role !== 'system') // AI SDK 的 system 单独传入，不重复放进消息列表。
    system ||= systemMessage?.content // 调用方单独传入的 system 优先级更高。

    // --- 根据协议创建 AI SDK 模型 ---
    const settings = { apiKey, baseURL, headers: options.headers } // 所有 Provider 都需要的连接配置。
    const stableKey = `agent:${baseURL}:${model}:${Bun.hash(JSON.stringify(system || ''))}` // 相同模型和 system 使用相同缓存键。
    const cache = ['chat', 'responses'].includes(protocol) ? { prompt_cache_key: stableKey, prompt_cache_retention: '24h' } : {} // 只有 OpenAI 风格协议支持这组缓存字段。
    const bodyOverrides = { ...cache, ...options.body } // 用户自定义 body 可以覆盖默认缓存字段。

    // 用户需要覆盖请求体时，拦截 AI SDK 的 fetch，把字段合并进最终 JSON。
    if (Object.keys(bodyOverrides).length) {
        settings.fetch = async (input, init) => {
            let body = init?.body // AI SDK 通常把请求体作为 JSON 字符串传进来。
            if (typeof body === 'string') {
                try {
                    body = { ...JSON.parse(body), ...bodyOverrides } // 保留 AI SDK 字段，再覆盖用户指定字段。
                } catch (error) {
                    throw new TypeError('AI SDK request body is not valid JSON', { cause: error }) // 无法解析时给出明确错误。
                }
            }
            return fetch(input, { ...init, body: body && JSON.stringify(body) }) // 重新编码后发给供应商。
        }
    }

    let providerModel // 不同 protocol 使用不同 Provider，但最后都变成 AI SDK model。
    if (protocol === 'chat') providerModel = createOpenAICompatible({ ...settings, name: 'agent' }).chatModel(model) // OpenAI Chat 兼容接口，适合中转站。
    if (protocol === 'responses') providerModel = createOpenAI(settings).responses(model) // OpenAI Responses 接口。
    if (protocol === 'anthropic') providerModel = createAnthropic(settings).languageModel(model) // Anthropic 接口。
    if (protocol === 'gemini') providerModel = createGoogle(settings).languageModel(model) // Google Gemini 接口。
    if (!providerModel) throw new Error(`Unsupported protocol: ${protocol}`) // 防止拼错协议后静默失败。

    // --- 组织一次统一的 AI SDK 请求 ---
    const input = { model: providerModel, system, messages: modelMessages, tools, toolChoice, abortSignal: signal } // 流式和非流式共用这份参数。

    // --- 非流式请求：等待模型完整返回 ---
    if (!stream) {
        const result = await generateText(input) // 非流式模式直接等待完整结果。
        return {
            text: await result.text, // 模型最后生成的文字。
            toolCalls: await result.toolCalls, // 模型要求执行的工具调用。
            finishReason: await result.finishReason, // 模型停止生成的原因。
            usage: await result.usage, // 本次请求消耗的 Token。
            warnings: await result.warnings, // Provider 对请求参数的提示。
            responseMessages: await result.responseMessages, // 保存完整 assistant/tool 消息。
        }
    }

    // --- 流式请求：逐个转发事件，再等待最终结果 ---
    const result = streamText(input) // 开始流式请求；真正的事件从 result.stream 产生。
    const text = [] // 单独收集文字，兼容部分 Provider 的事件字段差异。
    for await (const event of result.stream) {
        await onLLMEvent?.(event) // 不过滤事件，文字、思考、工具和错误都交给上层。
        if (event.type === 'text-delta') text.push(event.textDelta ?? event.text ?? event.delta ?? '') // 收集最终文字。
    }

    return {
        text: text.join('') || await result.text, // 优先使用事件收集的文字，没有则使用 AI SDK 最终文字。
        toolCalls: await result.toolCalls,
        finishReason: await result.finishReason,
        usage: await result.usage,
        warnings: await result.warnings,
        responseMessages: await result.responseMessages,
    }
}

export default { chat }
