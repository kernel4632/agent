/* 网页请求的瞬时故障使用 Agent 的统一无限退避。 */
export default {
    name: 'web_fetch', description: 'Fetch an HTTP or HTTPS URL and return its response.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', format: 'uri' } }, required: ['url'], additionalProperties: false },
    async execute({ url }, context) {
        const response = await context.retry(async () => {
            const value = await fetch(url, { signal: context.signal })
            if (!value.ok) throw Object.assign(new Error(`HTTP ${value.status}`), { status: value.status })
            return value
        })
        return { output: { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() } }
    },
}
