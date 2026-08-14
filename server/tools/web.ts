/*
网页读取工具：获取任意 HTTP 地址并返回状态、响应头和正文。
网络瞬时错误走与模型相同的无限退避策略，用户 stop 可以立即打断。
*/
import Retry from '../utils/retry.ts'
import type { AgentTool } from '../types.ts'

const webFetch: AgentTool = {
    name: 'web_fetch',
    description: 'Fetch an HTTP or HTTPS URL and return its status, headers, and body.',
    inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', format: 'uri' } },
        required: ['url'],
        additionalProperties: false,
    },
    async execute(input, context) {
        const { url } = input as { url: string }
        const response = await Retry.run(async () => {
            const response = await fetch(url, { signal: context.signal })
            if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
            return response
        }, context.signal)
        return { output: { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() } }
    },
}

export default webFetch
