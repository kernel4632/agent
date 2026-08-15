/* 用用户配置的 OpenAI 兼容搜索模型查询实时网页。 */
export default api => ({
    name: 'websearch',
    tools: [{
        name: 'web_search',
        description: 'Search the live web and return text with source URLs.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
        },
        async execute({ query }, context) {
            const settings = api.Store.config.plugins.websearch?.settings
            if (!settings) throw new Error('websearch plugin is not configured')

            // 搜索插件复用注入的 LLM 边界，不在插件内重新创建模型客户端。
            const result = await api.LLM.stream({
                provider: {
                    name: 'websearch',
                    baseURL: settings.baseURL,
                    key: settings.key,
                },
                model: {
                    id: settings.model,
                    maxOutput: settings.maxOutput || 4096,
                },
                messages: [{ role: 'user', content: query }],
                instructions: 'Search the live web and return concise results with source URLs.',
                signal: context.signal,
            })

            const text = result.message.parts
                .filter(part => part.type === 'text')
                .map(part => part.text)
                .join('')
            const sources = result.message.parts.filter(part => part.type === 'source-url')
            return { output: { text, sources } }
        },
    }],
})
