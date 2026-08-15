/* Store 是内存真相，并负责 JSON/JSONL 落盘和 SSE 广播。 */
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { writeFile } from 'atomically'
import Path from './utils/path.js'

const defaults = {
    auth: { username: '', password: '' },
    providers: [],
    prompts: {
        system: 'Continue until complete, then call finish.',
        tool: '',
        summary: 'Summarize completed work, decisions, current state and next steps.',
    },
    retry: { baseDelay: 1000, factor: 2, maxDelay: 60_000 },
    context: { compactRatio: 0.8, idleRounds: 3 },
    permission: [{ tool: '*', match: '*', action: 'ask' }],
    plugins: {},
}
const queues = new Map()

const Store = {
    config: structuredClone(defaults),
    workspaces: {},
    sessions: {},
    runtimes: {},

    async load() {
        await mkdir(Path.root(), { recursive: true, mode: 0o700 })
        await chmod(Path.root(), 0o700)

        const config = await readFile(Path.config(), 'utf8').then(JSON.parse)
            .catch(error => error.code === 'ENOENT' ? {} : Promise.reject(error))
        const workspaces = await readFile(Path.workspaces(), 'utf8').then(JSON.parse)
            .catch(error => error.code === 'ENOENT' ? {} : Promise.reject(error))

        this.config = {
            ...structuredClone(defaults),
            ...config,
            auth: { ...defaults.auth, ...config.auth },
            prompts: { ...defaults.prompts, ...config.prompts },
            retry: { ...defaults.retry, ...config.retry },
            context: { ...defaults.context, ...config.context },
            plugins: { ...defaults.plugins, ...config.plugins },
        }
        this.workspaces = workspaces
        this.sessions = {}
        this.runtimes = {}

        for (const workspace of Object.values(workspaces)) {
            for (const summary of workspace.sessions) {
                const meta = await readFile(Path.meta(summary.id), 'utf8').then(JSON.parse)
                    .catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
                if (!meta) continue

                const text = await readFile(Path.messages(summary.id), 'utf8')
                    .catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
                this.sessions[summary.id] = {
                    ...meta,
                    messages: text.split('\n').filter(Boolean).map(JSON.parse),
                }
                this.runtimes[summary.id] = {
                    status: 'idle',
                    abortController: new AbortController(),
                    clients: new Set(),
                    processes: new Set(),
                    permission: new Map(),
                    events: [],
                }
            }
        }

        await Promise.all([this.save('config'), this.save('workspaces')])
        return this
    },

    save(domain) {
        const previous = queues.get(domain) || Promise.resolve()
        const current = previous.catch(() => {}).then(async () => {
            if (domain === 'config' || domain === 'workspaces') {
                const path = domain === 'config' ? Path.config() : Path.workspaces()
                const value = domain === 'config' ? Store.config : Store.workspaces
                await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 })
                return chmod(path, 0o600)
            }

            const { messages, ...meta } = Store.sessions[domain]
            await mkdir(Path.session(domain), { recursive: true, mode: 0o700 })
            const lines = messages.map(JSON.stringify).join('\n')
            await writeFile(Path.meta(domain), JSON.stringify(meta, null, 2), { mode: 0o600 })
            await writeFile(Path.messages(domain), lines ? `${lines}\n` : '', { mode: 0o600 })
        })
        queues.set(domain, current.catch(() => {}))
        return current
    },

    async broadcast(sessionID, event) {
        const runtime = this.runtimes[sessionID]
        runtime.events.push(event)

        for (const client of runtime.clients) {
            try {
                client.enqueue(event)
                if (event.type === 'data-status' && event.data.status === 'idle') client.close()
            } catch {}
        }

        if (event.type === 'data-status' && event.data.status === 'idle') {
            runtime.clients.clear()
            runtime.events = []
        }
    },
}

export default Store
