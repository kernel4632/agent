/* 用用户配置的 OpenAI 兼容搜索模型查询实时网页。 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'

export default api => ({
    name: 'websearch',
    tools: [{
        name: 'web_search', description: 'Search the live web and return text with source URLs.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
        async execute({ query }, context) {
            const settings = api.Store.config.plugins.websearch?.settings
            if (!settings) throw new Error('websearch plugin is not configured')
            const provider = createOpenAICompatible({ name: 'websearch', baseURL: settings.baseURL, apiKey: settings.key })
            const result = await context.retry(() => generateText({
                model: provider.chatModel(settings.model), prompt: query,
                abortSignal: context.signal, maxRetries: 0, providerOptions: settings.providerOptions,
            }))
            return { output: { text: result.text, sources: result.sources } }
        },
    }],
})
