import { resolve } from 'node:path'
import { describe, expect, it } from 'bun:test'
import CronPlugin from '../plugins/cron/index.ts'
import MCPPlugin from '../plugins/mcp/index.ts'
import TitlePlugin from '../plugins/title/index.ts'
import WebsearchPlugin from '../plugins/websearch/index.ts'
import Retry from '../utils/retry.ts'

describe('First-party plugins', () => {
    it('generates a title once for the first user message', async () => {
        let title = ''
        let calls = 0
        const session = { id: 'session', workspaceID: 'workspace', provider: 'provider', model: 'model' }
        const api = {
            Session: {
                read: () => session,
                rename: async (_id: string, value: string) => { title = value },
            },
            Store: { workspaces: { workspace: { sessions: [{ id: 'session', get title() { return title } }] } } },
            LLM: {
                chat: async () => {
                    calls += 1
                    return { message: { parts: [{ type: 'text', text: 'Test title' }] } }
                },
            },
        }
        const plugin = TitlePlugin(api)
        const message = { id: 'message', role: 'user', parts: [{ type: 'text', text: 'request' }] }
        await plugin.hooks!['message.append']!({ sessionID: 'session', message })
        await plugin.hooks!['message.append']!({ sessionID: 'session', message })
        expect(title).toBe('Test title')
        expect(calls).toBe(1)
    })

    it('triggers cron jobs through Agent.send and stops them on unload', async () => {
        const sent: unknown[] = []
        const api = {
            Agent: { send: (...input: unknown[]) => sent.push(input) },
            Store: { config: { plugins: { cron: { settings: { jobs: [{ cron: '* * * * * *', sessionID: 'session', message: 'tick' }] } } } } },
        }
        const plugin = CronPlugin(api)
        await Bun.sleep(1100)
        await plugin.unload!()
        expect(sent.length).toBeGreaterThanOrEqual(1)
        expect(sent[0]).toEqual(['session', 'tick'])
    })

    it('discovers and calls tools through a real MCP stdio server', async () => {
        const script = resolve('node_modules/@modelcontextprotocol/server-everything/dist/index.js')
        const api = {
            Store: { config: { plugins: { mcp: { settings: { servers: {
                test: { type: 'stdio', command: [process.execPath, script, 'stdio'] },
            } } } } } },
            Retry,
        }
        const plugin = await MCPPlugin(api)
        const echo = plugin.tools!.find(tool => tool.name === 'test__echo')!
        expect(echo).toBeDefined()
        const result = await echo.execute({ message: 'hello' }, {
            sessionID: 'session', messageID: 'message', partIndex: 0, signal: new AbortController().signal,
        })
        expect(JSON.stringify(result.output)).toContain('hello')
        await plugin.unload!()
    })

    it('registers a working web search tool', async () => {
        const server = Bun.serve({
            port: 0,
            fetch: () => Response.json({
                id: 'response',
                object: 'chat.completion',
                created: 0,
                model: 'search',
                choices: [{ index: 0, message: { role: 'assistant', content: 'search result' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
            }),
        })
        const api = {
            Store: { config: { plugins: { websearch: { settings: {
                baseURL: `http://127.0.0.1:${server.port}/v1`, key: 'test', model: 'search',
            } } } } },
            Retry,
        }
        const plugin = WebsearchPlugin(api)
        const result = await plugin.tools![0]!.execute({ query: 'current event' }, {
            sessionID: 'session', messageID: 'message', partIndex: 0, signal: new AbortController().signal,
        })
        server.stop()
        expect((result.output as any).text).toBe('search result')
    })
})
