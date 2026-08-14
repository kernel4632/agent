import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'bun:test'
import { parse } from 'jsonc-parser'
import LLM from '../utils/llm.ts'
import Store from '../store.ts'
import Agent from '../commands/agent.ts'
import Config from '../commands/config.ts'
import Session from '../commands/session.ts'
import Workspace from '../commands/workspace.ts'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'

const configPath = process.env.OPENCODE_CONFIG || `${process.env.HOME}/.config/opencode/opencode.jsonc`

const configure = async (providerName: string, modelID: string) => {
    const config = parse(await readFile(configPath, 'utf8')) as any
    const provider = config.provider[providerName]
    const model = provider?.models?.[modelID]
    if (!provider || !model) throw new Error(`OpenCode provider model not found: ${providerName}/${modelID}`)
    process.env.AGENT_HOME = join(tmpdir(), `agent-real-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults)
    Store.workspaces = {}
    Store.sessions = {}
    Store.runtimes = {}
    await Config.load()
    await Workspace.load()
    await Session.load()
    Store.config.providers = [{ name: providerName, baseURL: provider.options.baseURL, key: provider.options.apiKey, models: [{
        id: modelID, contextWindow: model.limit.context, maxOutput: Math.min(model.limit.output, 32768),
    }] }]
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
    return { providerName, modelID }
}

const runAgent = async (providerName: string, modelID: string, prompt: string) => {
    const workspace = await Workspace.add(process.env.AGENT_HOME!)
    const session = await Session.create(workspace.id, providerName, modelID)
    await Agent.send(session.id, prompt)
    await Store.runtimes[session.id]!.task
    return session
}

describe('Configured real model', () => {
    it.skipIf(process.env.RUN_REAL_MODEL !== '1')('streams through the provider from OpenCode config', async () => {
        const config = parse(await readFile(configPath, 'utf8')) as any
        const selected = String(config.model || '').split('/')
        const providerName = selected[0]
        const modelID = selected.slice(1).join('/')
        if (!providerName || !modelID) throw new Error('OpenCode default model is not configured')
        const provider = config.provider[providerName]
        if (!provider?.models?.[modelID]) throw new Error(`OpenCode provider model not found: ${providerName}/${modelID}`)
        Store.config.providers = [{
            name: providerName,
            baseURL: provider.options.baseURL,
            key: provider.options.apiKey,
            models: [{
                id: modelID,
                contextWindow: provider.models[modelID].limit.context,
                maxOutput: provider.models[modelID].limit.output,
            }],
        }]
        const localProvider = Store.config.providers[0]!
        const result = await LLM.chat({
            provider: localProvider,
            model: localProvider.models[0]!,
            retry: Store.config.retry,
            messages: [{ role: 'user', content: 'Reply with exactly the word READY.' }],
            instructions: 'Reply with exactly the word READY.',
        })
        expect(result.message.parts.some(part => part.type === 'text' && part.text.length > 0)).toBe(true)
        expect(result.usage.inputTokens).toBeGreaterThan(0)
    }, 120_000)

    it.skipIf(process.env.RUN_REAL_MODEL !== '1')('reads an inline image through the configured multimodal model', async () => {
        const config = parse(await readFile(configPath, 'utf8')) as any
        const [providerName, ...modelParts] = String(config.model || '').split('/')
        const modelID = modelParts.join('/')
        if (!providerName || !modelID) throw new Error('OpenCode default model is not configured')
        const provider = config.provider[providerName]
        Store.config.providers = [{ name: providerName, baseURL: provider.options.baseURL, key: provider.options.apiKey, models: [{
            id: modelID, contextWindow: provider.models[modelID].limit.context, maxOutput: provider.models[modelID].limit.output,
        }] }]
        const localProvider = Store.config.providers[0]!
        const png = Uint8Array.fromBase64('iVBORw0KGgoAAAANSUhEUgAAAGAAAABAAgMAAACYWpqdAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAACVBMVEX/AAAAAP////8Ul8VoAAAAAWJLR0QCZgt8ZAAAAAd0SU1FB+oIDQwUJKKmy7gAAAAdSURBVDjLY2BAAqFIgGFUYlRiVGJUYlRiVAK3BAAamf8BpyBzUwAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOC0xM1QxMjoyMDozNiswMDowMJHCgWMAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDgtMTNUMTI6MjA6MzYrMDA6MDDgnznfAAAAAElFTkSuQmCC')
        const result = await LLM.chat({
            provider: localProvider,
            model: localProvider.models[0]!,
            retry: Store.config.retry,
            messages: [{ role: 'user', content: [
                { type: 'text', text: 'Name the two colors in this image. Reply with only the two color names.' },
                { type: 'file', data: png, mediaType: 'image/png' },
            ] }],
            instructions: 'Read the image and reply with only its two color names.',
        })
        const text = result.message.parts.flatMap(part => part.type === 'text' ? [part.text.toLowerCase()] : []).join(' ')
        expect(text).toContain('red')
        expect(text).toContain('blue')
    }, 120_000)

    it.skipIf(process.env.RUN_REAL_MODEL !== '1')('reports a cache hit for a repeated long prefix', async () => {
        const config = parse(await readFile(configPath, 'utf8')) as any
        const [providerName, ...modelParts] = String(config.model || '').split('/')
        const modelID = modelParts.join('/')
        if (!providerName || !modelID) throw new Error('OpenCode default model is not configured')
        const provider = config.provider[providerName]
        if (!provider?.models?.[modelID]) throw new Error(`OpenCode provider model not found: ${providerName}/${modelID}`)
        Store.config.providers = [{ name: providerName, baseURL: provider.options.baseURL, key: provider.options.apiKey, models: [{
            id: modelID, contextWindow: provider.models[modelID].limit.context, maxOutput: provider.models[modelID].limit.output,
        }] }]
        const localProvider = Store.config.providers[0]!
        const prefix = Array.from({ length: 3000 }, (_, index) => `stable-cache-token-${index}`).join(' ')
        const request = () => LLM.chat({
            provider: localProvider,
            model: localProvider.models[0]!,
            retry: Store.config.retry,
            messages: [{ role: 'user', content: `${prefix}\nReply with exactly CACHE.` }],
            instructions: 'Reply with exactly CACHE.',
        })
        await request()
        let cacheReadTokens = 0
        for (let attempt = 0; attempt < 5 && cacheReadTokens === 0; attempt += 1) {
            const repeated = await request()
            cacheReadTokens = repeated.usage.inputTokenDetails?.cacheReadTokens ?? 0
        }
        expect(cacheReadTokens).toBeGreaterThan(0)
    }, 180_000)

    it.skipIf(process.env.RUN_REAL_AGENT !== '1')('runs Kimi tools to an explicit finish without cache reads', async () => {
        const { providerName, modelID } = await configure('aker-other', 'kimi-k2.6')
        const session = await runAgent(providerName, modelID, 'Use file_list once on the workspace directory, then call finish. You must call finish.')
        const assistants = session.messages.filter(message => message.role === 'assistant')
        expect(assistants.some(message => message.parts.some((part: any) => part.toolName === 'file_list' && part.state === 'output-available'))).toBe(true)
        expect(assistants.some(message => message.parts.some((part: any) => part.toolName === 'finish' && part.state === 'output-available'))).toBe(true)
        expect(assistants.reduce((total, message) => total + (message.usage?.inputTokenDetails?.cacheReadTokens ?? 0), 0)).toBe(0)
    }, 240_000)

    it.skipIf(process.env.RUN_REAL_AGENT !== '1')('runs GPT tool rounds through finish with substantial cache reads', async () => {
        const { providerName, modelID } = await configure('aker-openai', 'gpt-5.6-sol')
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, providerName, modelID)
        const stablePrefix = Array.from({ length: 2000 }, (_, index) => `stable-agent-prefix-${index}`).join(' ')
        for (let index = 0; index < 4; index += 1) {
            await Agent.send(session.id, `${index === 0 ? `${stablePrefix}\n` : ''}Round ${index}: use file_list once on the workspace directory, then call finish. You must call finish.`)
            await Store.runtimes[session.id]!.task
        }
        const assistants = session.messages.filter(message => message.role === 'assistant')
        const finishes = assistants.filter(message => message.parts.some((part: any) => part.toolName === 'finish' && part.state === 'output-available'))
        const cacheRead = assistants.reduce((total, message) => total + (message.usage?.inputTokenDetails?.cacheReadTokens ?? 0), 0)
        expect(finishes).toHaveLength(4)
        expect(cacheRead).toBeGreaterThan(10_000)
    }, 360_000)
})
