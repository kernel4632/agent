/* 全部内存数据、明文加载保存和会话事件广播。 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { writeFile } from 'atomically'
import Path from './utils/path.js'

const defaults = {
    auth: { username: '', password: '' }, providers: [],
    prompts: { system: 'Continue until complete, then call finish.', tool: '', summary: 'Summarize completed work, decisions, current state and next steps.' },
    retry: { baseDelay: 1000, factor: 2, maxDelay: 60_000 },
    context: { compactRatio: 0.8, idleRounds: 3 },
    permission: [{ tool: '*', match: '*', action: 'ask' }], plugins: {},
}

const Store = {
    defaults, config: structuredClone(defaults), workspaces: {}, sessions: {}, runtimes: {},

    async load() {
        await mkdir(Path.root(), { recursive: true })
        const config = await readFile(Path.config(), 'utf8').then(JSON.parse).catch(() => ({}))
        const workspaces = await readFile(Path.workspaces(), 'utf8').then(JSON.parse).catch(() => ({}))
        this.config = {
            ...structuredClone(defaults), ...config,
            auth: { ...defaults.auth, ...config.auth },
            prompts: { ...defaults.prompts, ...config.prompts },
            retry: { ...defaults.retry, ...config.retry },
            context: { ...defaults.context, ...config.context },
            plugins: { ...defaults.plugins, ...config.plugins },
        }
        this.workspaces = workspaces
        this.sessions = {}
        this.runtimes = {}
        for (const workspace of Object.values(workspaces)) for (const summary of workspace.sessions) {
            const meta = await readFile(Path.meta(summary.id), 'utf8').then(JSON.parse).catch(() => null)
            if (!meta) continue
            const text = await readFile(Path.messages(summary.id), 'utf8').catch(() => '')
            const messages = text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
            this.sessions[summary.id] = { ...meta, messages }
            this.runtimes[summary.id] = { status: 'idle', abortController: new AbortController(), clients: new Set(), processes: new Set(), permission: new Map(), events: [] }
        }
        await this.save('config')
        await this.save('workspaces')
        return this
    },

    async save(domain) {
        if (domain === 'config') return writeFile(Path.config(), JSON.stringify(this.config, null, 2))
        if (domain === 'workspaces') return writeFile(Path.workspaces(), JSON.stringify(this.workspaces, null, 2))
        const { messages, ...meta } = this.sessions[domain]
        await mkdir(Path.session(domain), { recursive: true })
        await writeFile(Path.meta(domain), JSON.stringify(meta, null, 2))
    },

    async broadcast(sessionID, event) {
        const runtime = this.runtimes[sessionID]
        runtime.events.push(event)
        for (const client of runtime.clients) try {
            client.enqueue(event)
            if (event.type === 'data-status' && event.data.status === 'idle') {
                client.close()
                runtime.clients.delete(client)
            }
        } catch { runtime.clients.delete(client) }
    },
}

export { appendFile }
export default Store
