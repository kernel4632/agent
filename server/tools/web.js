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
        const response = await context.retry(async () => { // 将临时 HTTP 失败交给统一退避。
            const value = await fetch(url, { signal: context.signal }) // stop 会中止网络请求。
            if (!value.ok) throw Object.assign(new Error(`HTTP ${value.status}`), { status: value.status }) // 交给重试器判断。
            return value // 仅成功响应进入正文读取。
        })

        // 返回状态、响应头和正文，保持工具结果可直接展示。
        return { output: {
            status: response.status, // 保留页面状态码。
            headers: Object.fromEntries(response.headers), // 保留可检查的响应头。
            body: await response.text(), // 读取完整文本正文。
        } }
    },
}
