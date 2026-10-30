/* Real backend + real CLI process; only the external model is a local fixture.
 * Run after go build -o ../tmp/cli-test/agent.exe ./cmd/agent (Windows).
 * AGENT_CLI_BIN overrides the binary location on other platforms.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const home = join(root, 'tmp', `cli-integration-${crypto.randomUUID()}`)
const binary = process.env.AGENT_CLI_BIN || join(root, 'tmp/cli-test', process.platform === 'win32' ? 'agent.exe' : 'agent')
let app, model, address
const previousHome = process.env.AGENT_HOME

async function cli(...args) {
    const child = Bun.spawn([binary, '--server', address, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 15000)
    try {
        const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
        return { code, out, err }
    } finally { clearTimeout(timer) }
}

async function getSession(id) {
    return (await fetch(`${address}/session/read/${id}`)).json()
}

async function waitIdle(id) {
    for (let i = 0; i < 200; i++) {
        const session = await getSession(id)
        if (!session.running) return session
        await Bun.sleep(20)
    }
    throw new Error(`Session ${id} did not finish`)
}

beforeAll(async () => {
    await mkdir(home, { recursive: true })
    await Bun.write(join(home, 'sample.txt'), 'fixture file contents')
    process.env.AGENT_HOME = home
    model = Bun.serve({
        port: 0,
        async fetch(request) {
            const body = await request.json()
            const userIndex = body.messages.findLastIndex(message => message.role === 'user')
            const prompt = JSON.stringify(body.messages[userIndex]?.content)
            const usedTool = body.messages.slice(userIndex).some(message => message.role === 'tool')
            let message = { role: 'assistant', content: 'CLI 中文回复' }
            if (prompt?.includes('[complete]') && !usedTool) {
                message = { role: 'assistant', content: null, tool_calls: [{ id: 'complete-1', type: 'function', function: { name: 'attempt_completion', arguments: JSON.stringify({ result: '工具最终答复' }) } }] }
            } else if (prompt?.includes('[tool]') && !usedTool) {
                message = { role: 'assistant', content: null, tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: join(home, 'sample.txt') }) } }] }
            }
            if (body.stream) {
                const chunks = [
                    { choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '先分析需求。' } }] },
                    { choices: [{ index: 0, delta: { content: '流式' } }] },
                    { choices: [{ index: 0, delta: { content: '中文答复' } }] },
                    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
                ]
                return new Response(new ReadableStream({
                    async start(controller) {
                        for (const chunk of chunks) {
                            const event = { id: 'stream', object: 'chat.completion.chunk', created: 1, model: 'test', ...chunk }
                            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
                            await Bun.sleep(25)
                        }
                        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
                        controller.close()
                    },
                }), { headers: { 'content-type': 'text/event-stream' } })
            }
            return Response.json({
                id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture',
                choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
                usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
            })
        },
    })
    await Bun.write(join(home, 'config.json'), JSON.stringify({
        prompt: { seeded: true, system: 'test' },
        providers: [{ name: 'fixture', baseURL: `http://127.0.0.1:${model.port}/v1`, stream: false, models: [{ id: 'test', capabilities: ['text', 'tools'], context: 128000 }] }],
        models: { chat: { provider: 'fixture', model: 'test' } }, permission: { '*': 'ask' },
    }))
    const server = await import('../../server/server.js')
    app = await server.start({ port: 0 })
    address = `http://127.0.0.1:${app.server.port}`
})

afterAll(async () => {
    await app?.stop(true)
    model?.stop(true)
    if (previousHome === undefined) delete process.env.AGENT_HOME
    else process.env.AGENT_HOME = previousHome
    await rm(home, { recursive: true, force: true })
})

test('health, model discovery, multi-turn history and reasoning use the real HTTP contract', async () => {
    expect((await cli('health')).code).toBe(0)
    const models = await cli('models', '--json')
    expect(JSON.parse(models.out)[0]).toMatchObject({ provider: 'fixture', model: 'test' })
    expect(models.out).not.toContain('apiKey')
    const answer = await cli('ask', '你好', '--title', 'CLI test', '--reasoning', 'high')
    expect(answer.code).toBe(0)
    expect(answer.out.trim()).toBe('CLI 中文回复')
    const id = answer.err.match(/会话: (\S+)/)[1]
    expect((await cli('ask', '第二轮', '--session', id)).out.trim()).toBe('CLI 中文回复')
    const saved = JSON.parse((await cli('sessions', 'show', id, '--json')).out)
    expect(saved.settings.reasoning).toBe('high')
    expect(saved.cwd).toBe(root)
    expect(saved.history.filter(item => item.role === 'user')).toHaveLength(2)
    expect((await cli('sessions', 'rename', id, 'changed')).code).toBe(0)
    expect((await cli('sessions', 'list', '--search', 'changed')).out).toContain(id)
    expect((await cli('sessions', 'remove', id)).code).toBe(0)
    expect((await cli('sessions', 'show', id)).code).toBe(1)
}, 30000)

test('control-tool final answers and approval work without a web browser', async () => {
    const answer = await cli('ask', '[complete]', '--title', 'completion')
    expect(answer.code).toBe(0)
    expect(answer.out.trim()).toBe('工具最终答复')
    const allowed = await cli('ask', '[tool]', '--title', 'approval', '--permission', 'allow-once')
    expect(allowed.code).toBe(0)
    expect(allowed.out).toContain('CLI 中文回复')
    const pending = await cli('ask', '[tool]', '--title', 'pending')
    expect(pending.code).toBe(1)
    expect(pending.err).toContain('待审批')
    const id = pending.err.match(/会话: (\S+)/)[1]
    const session = JSON.parse((await cli('sessions', 'show', id, '--json')).out)
    expect(session.pending[0].callID).toBe('read-1')
    expect((await cli('ask', 'conflict', '--session', id)).code).toBe(1)
    expect((await cli('sessions', 'decide', id, 'read-1', 'deny')).code).toBe(0)
    // Wait for the real background run to finish before removing the data home.
    await waitIdle(id)
}, 30000)

test('NDJSON includes final persisted history; invalid input and conflicts fail', async () => {
    const answer = await cli('ask', 'json', '--title', 'json', '--json')
    expect(answer.code).toBe(0)
    const events = answer.out.trim().split('\n').map(line => JSON.parse(line))
    expect(events.some(event => event.type === 'agent-finish')).toBe(true)
    expect(events.at(-1).type).toBe('result')
    expect(events.at(-1).session.history.some(message => message.usage?.input === 12)).toBe(true)
    expect((await cli('ask', ' ')).code).toBe(1)
    expect((await cli('ask', 'x', '--reasoning', 'invalid')).code).toBe(1)
    expect((await cli('sessions', 'decide', 'missing', 'call', 'invalid')).code).toBe(1)
})

test('real streaming sends deltas and resume does not add a user message', async () => {
    const config = await (await fetch(`${address}/config/read`)).json()
    config.providers[0].stream = true
    await fetch(`${address}/config/set`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) })
    const answer = await cli('ask', 'stream', '--title', 'stream', '--json')
    expect(answer.code).toBe(0)
    const events = answer.out.trim().split('\n').map(line => JSON.parse(line))
    expect(events.filter(event => event.type === 'text-delta').map(event => event.text).join('')).toBe('流式中文答复')
    const session = events.at(-1).session
    const userCount = session.history.filter(item => item.role === 'user').length
    const resumed = await cli('ask', '--session', session.id, '--resume')
    expect(resumed.code).toBe(0)
    expect(resumed.out).toContain('流式中文答复')
    expect((await getSession(session.id)).history.filter(item => item.role === 'user')).toHaveLength(userCount)
}, 30000)
