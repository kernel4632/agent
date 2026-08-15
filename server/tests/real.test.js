import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'
import { parse } from 'jsonc-parser'
import { expect, test } from 'bun:test'
import LLM from '../utils/llm.js'
import Store from '../store.js'
import Workspace from '../commands/workspace.js'
import Session from '../commands/session.js'
import Agent from '../commands/agent.js'

const configPath = process.env.AGENT_CONFIG || `${process.env.HOME}/.config/opencode/opencode.jsonc`
const configured = process.env.RUN_REAL_MODEL === '1'
const config = configured ? parse(await readFile(configPath, 'utf8')) : null
const selected = String(config?.model || '').split('/')
const providerConfig = config?.provider?.[selected[0]]
const modelConfig = providerConfig?.models?.[selected.slice(1).join('/')]
const request = providerConfig && modelConfig ? {
    provider: { name: selected[0], baseURL: providerConfig.options.baseURL, key: providerConfig.options.apiKey },
    model: { id: selected.slice(1).join('/'), contextWindow: modelConfig.limit.context, maxOutput: Math.min(modelConfig.limit.output, 4096) },
} : null

test.skipIf(!configured)('real model smoke test', async () => {
    if (!request) throw new Error('OpenCode provider model is not configured')

    const result = await LLM.stream({
        ...request,
        messages: [{ role: 'user', content: 'Reply with exactly the word READY.' }],
        instructions: 'Return only READY.',
        signal: AbortSignal.timeout(60_000),
    })

    expect(result.message.parts.some(part => part.type === 'text' && part.text.includes('READY'))).toBe(true)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
}, 120_000)

test.skipIf(process.env.RUN_REAL_AGENT !== '1')('real agent completes a tool round', async () => {
    if (!request) throw new Error('OpenCode provider model is not configured')

    const home = join(tmpdir(), `agent-real-test-${nanoid()}`)
    process.env.AGENT_HOME = home
    await mkdir(home, { recursive: true })
    await Store.load()
    Store.config.providers = [{ ...request.provider, models: [request.model] }]
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]

    const workspace = await Workspace.add(home)
    const session = await Session.create(workspace.id, request.provider.name, request.model.id)
    await Agent.send(session.id, `Use file_list exactly once on ${home}, then call finish with result DONE.`)

    const started = Date.now()
    while (Store.runtimes[session.id].status === 'running' && Date.now() - started < 240_000) await Bun.sleep(100)

    const parts = session.messages.flatMap(message => message.parts)
    expect(Store.runtimes[session.id].status).toBe('idle')
    expect(parts.some(part => part.type === 'tool-file_list' && part.state === 'output-available')).toBe(true)
    expect(parts.some(part => part.type === 'tool-finish' && part.state === 'output-available')).toBe(true)
}, 300_000)

test.skipIf(process.env.RUN_REAL_AGENT !== '1')('real agent builds a complete static website', async () => {
    if (!request) throw new Error('OpenCode provider model is not configured')

    const home = join(tmpdir(), `agent-real-site-${nanoid()}`)
    const project = join(home, 'site')
    process.env.AGENT_HOME = join(home, 'data')
    await mkdir(project, { recursive: true })
    await Store.load()
    Store.config.providers = [{ ...request.provider, models: [request.model] }]
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]

    const workspace = await Workspace.add(project)
    const session = await Session.create(workspace.id, request.provider.name, request.model.id)
    await Agent.send(session.id, `Build a usable task board website in ${project}. Create index.html, style.css and script.js with absolute paths. Verify the files, then call finish.`)

    const started = Date.now()
    while (Store.runtimes[session.id].status === 'running' && Date.now() - started < 300_000) await Bun.sleep(100)

    expect(Store.runtimes[session.id].status).toBe('idle')
    expect(await Bun.file(join(project, 'index.html')).exists()).toBe(true)
    expect(await Bun.file(join(project, 'style.css')).exists()).toBe(true)
    expect(await Bun.file(join(project, 'script.js')).exists()).toBe(true)
}, 360_000)
