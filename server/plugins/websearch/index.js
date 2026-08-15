/* 用用户配置的 OpenAI 兼容搜索模型查询实时网页。 */
export default api => ({ // 工厂从注入的 Store 与 LLM 取得全部能力。
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
            const settings = api.Store.config.plugins.websearch?.settings // 读取用户配置的搜索端点。
            if (!settings) throw new Error('websearch plugin is not configured') // 未配置时给出明确原因。

            // 搜索插件复用注入的 LLM 边界，不在插件内重新创建模型客户端。
            const result = await api.LLM.stream({
                provider: {
                    name: 'websearch', // 对应 LLM 中的兼容提供商名称。
                    baseURL: settings.baseURL, // 使用用户指定的搜索端点。
                    key: settings.key, // 使用用户保存的访问密钥。
                },
                model: {
                    id: settings.model, // 使用用户选定搜索模型。
                    maxOutput: settings.maxOutput || 4096, // 默认允许足够的结果文本。
                },
                messages: [{ role: 'user', content: query }],
                instructions: 'Search the live web and return concise results with source URLs.',
                extraBody: {
                    tools: [{ type: 'web_search', web_search: { max_search_results: 5 } }], // 显式启用服务端联网。
                },
                signal: context.signal,
            })

            const text = result.message.parts
                .filter(part => part.type === 'text')
                .map(part => part.text)
                .join('')
            const sources = result.message.parts.filter(part => part.type === 'source-url') // 保留模型附带来源。
            return { output: { text, sources } } // 返回文本与来源供下一轮模型使用。
        },
    }],
})
