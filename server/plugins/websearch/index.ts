/*
网页搜索插件：调用用户配置的 OpenAI 兼容搜索模型，并返回带来源的搜索结果。
*/
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import type { AgentTool, PluginModule } from '../../types.ts'

export default (api: any): PluginModule => {
    const search: AgentTool = {
        name: 'web_search',
        description: 'Search the live web and return current information with source URLs.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
        },
        async execute(input, context) {
            const settings = api.Store.config.plugins.websearch?.settings as any
            if (!settings) throw new Error('websearch plugin is not configured')
            const provider = createOpenAICompatible({ name: 'websearch', baseURL: settings.baseURL, apiKey: settings.key })
            const result = await api.Retry.run(() => generateText({
                model: provider.chatModel(settings.model),
                prompt: (input as any).query,
                abortSignal: context.signal,
                maxRetries: 0,
                providerOptions: settings.providerOptions,
            }), context.signal)
            return { output: { text: result.text, sources: result.sources } }
        },
    }
    return { name: 'websearch', tools: [search] }
}
