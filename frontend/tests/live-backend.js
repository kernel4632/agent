/* 真实联调服务：启动项目后端，仅把收费的模型接口替换成本机固定回复。
 * 由 playwright.live.config.js 启动；所有配置和会话写入 tmp/ 下的新目录。
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { start } from '../../server/server.js'

const temporary = fileURLToPath(new URL('../../tmp/', import.meta.url))
await mkdir(temporary, { recursive: true })
process.env.AGENT_HOME = await mkdtemp(join(temporary, 'live-contract-'))

// 请求经过真实 agent-core、HTTP 和 SSE；模型端只返回固定文本，不执行外部工具。
const model = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== '/v1/chat/completions') return new Response('Not found', { status: 404 })
    const body = await request.json()
    const text = '本地测试模型回复：已收到消息。'
    const base = { id: 'local-reply', model: body.model, created: Math.floor(Date.now() / 1000) }
    const usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
    if (!body.stream) return Response.json({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage })
    const chunks = [
      { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
      { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
    ]
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  },
})

const target = { provider: '本地联调', model: 'local-test' }
await writeFile(join(process.env.AGENT_HOME, 'config.json'), JSON.stringify({
  providers: [{ name: target.provider, baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: 'local-test-only', protocol: 'openai-compatible', stream: true, headers: { 'x-test': 'preserve' }, body: { temperature: 0.2 }, models: [{ id: target.model, name: target.model, context: 64000, capabilities: ['text', 'tools'] }] }],
  models: { chat: target }, prompt: { system: '直接回复文字。', seeded: true }, permission: { '*': 'deny' }, mcp: {}, compact: { threshold: 0.8 },
}))
await start({ port: Number(process.env.PORT || 3001) })
console.log('Live integration backend ready')
