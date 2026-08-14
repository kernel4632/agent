import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Workspace from '../commands/workspace.js'
import Session from '../commands/session.js'
import Agent from '../commands/agent.js'

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-loop-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults); Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    await Store.load()
})

const wait = async session => { while (Store.runtimes[session.id].status === 'running') await Bun.sleep(5) }
const response = tool => new Response([
    `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments } }] }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`, 'data: [DONE]\n\n',
].join(''), { headers: { 'content-type': 'text/event-stream' } })

test('runs a real OpenAI-compatible tool round through finish', async () => {
    const target = join(process.env.AGENT_HOME, 'result.txt')
    let step = 0
    const model = Bun.serve({ port: 0, fetch: () => {
        step += 1
        return response(step === 1
            ? { id: 'write', name: 'file_write', arguments: JSON.stringify({ path: target, content: 'written' }) }
            : { id: 'finish', name: 'finish', arguments: JSON.stringify({ result: 'done' }) })
    } })
    Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Agent.send(session.id, 'write the file and finish')
    await wait(session)
    model.stop()
    expect(await Bun.file(target).text()).toBe('written')
    expect(step).toBe(2)
    expect(session.messages.some(message => message.parts.some(part => part.state === 'output-available'))).toBe(true)
})
