/*
把配置里的供应商和模型翻译成 agent-core 的连接参数，以及给前端的模型列表。
模型 id 对外是 `供应商名/模型 id`。某一档思考强度写的参数原样合进 core 的 config，代码不认识任何一家供应商。
*/

export const Models = {
    // 前端要的列表：id、显示名、支持的思考强度、上下文预算。
    list(config) {
        const result = []
        for (const provider of config.providers ?? []) {
            for (const model of provider.models ?? []) {
                const efforts = model.efforts && Object.keys(model.efforts)
                result.push({
                    id: `${provider.name}/${model.id}`,
                    name: model.name ?? model.id,
                    context: model.context,
                    ...(efforts?.length ? { efforts } : {}),
                })
            }
        }
        return result
    },

    /*
    把一个 `供应商/模型` 和可选的思考强度，翻译成 Agent.create / agent.config 能直接用的字段。
    找不到就抛错，让调用方知道是配置问题。
    */
    resolve(config, id, effort) {
        if (!id) throw new Error('未配置模型')
        const split = id.indexOf('/')
        if (split <= 0) throw new Error(`模型 id 必须是「供应商/模型」，收到 ${id}`)
        const providerName = id.slice(0, split)
        const modelId = id.slice(split + 1)
        const provider = (config.providers ?? []).find(item => item.name === providerName)
        if (!provider) throw new Error(`找不到供应商 ${providerName}`)
        const model = (provider.models ?? []).find(item => item.id === modelId)
        if (!model) throw new Error(`供应商 ${providerName} 里找不到模型 ${modelId}`)
        const extras = effort && model.efforts ? model.efforts[effort] : undefined
        if (effort && model.efforts && extras === undefined) throw new Error(`${id} 不支持思考强度 ${effort}`)
        const { provider: extraProvider, ...rest } = extras ?? {}
        return {
            model: model.id,
            baseURL: provider.baseURL,
            apiKey: provider.apiKey,
            protocol: provider.protocol,
            maxContextTokens: model.context,
            ...rest,
            ...(provider.provider || extraProvider ? { provider: { ...provider.provider, ...extraProvider } } : {}),
        }
    },
}
