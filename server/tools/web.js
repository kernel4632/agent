/* 网页请求的瞬时故障使用 Agent 的统一无限退避。 */
export default {
    name: 'web_fetch',
    description: 'Fetch an HTTP or HTTPS URL and return its response.',
    inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', format: 'uri' } },
        required: ['url'],
        additionalProperties: false,
    },
    async execute({ url }, context) {
        // 只有网络临时故障会由统一重试策略再次请求。
        const response = await context.retry(async () => {
            const value = await fetch(url, { signal: context.signal })
            if (!value.ok) throw Object.assign(new Error(`HTTP ${value.status}`), { status: value.status })
            return value
        })

        // 返回状态、响应头和正文，保持工具结果可直接展示。
        return { output: {
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.text(),
        } }
    },
}
