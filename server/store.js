/* Store 是内存真相，并负责 JSON/JSONL 落盘和 SSE 广播。 */
import { chmod, mkdir, readFile } from 'node:fs/promises' // 管理数据目录权限并读取明文文件。
import { writeFile } from 'atomically' // 用原子替换避免半写文件。
import Path from './utils/path.js' // 统一计算配置和会话文件位置。

const defaults = { // 缺失配置始终从这份可运行默认值补齐。
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
const queues = new Map() // 每个持久化域按调用顺序串行写入。

const Store = {
    config: structuredClone(defaults), // 启动前也提供完整默认配置。
    workspaces: {}, sessions: {}, runtimes: {}, // 三类内存业务真相。

    async load() {
        await mkdir(Path.root(), { recursive: true, mode: 0o700 }) // 首次运行创建私有数据根目录。
        await chmod(Path.root(), 0o700) // 已存在目录也收紧为仅当前用户可读写。

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
        Object.assign(this, { workspaces, sessions: {}, runtimes: {} }) // 用磁盘索引重建空白内存状态。

        for (const workspace of Object.values(workspaces)) {
            for (const summary of workspace.sessions) {
                const meta = await readFile(Path.meta(summary.id), 'utf8').then(JSON.parse)
                    .catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
                if (!meta) continue // 元数据已丢失的摘要不恢复成残缺会话。

                const text = await readFile(Path.messages(summary.id), 'utf8')
                    .catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
                this.sessions[summary.id] = {
                    ...meta,
                    messages: text.split('\n').filter(Boolean).map(JSON.parse),
                }
                this.runtimes[summary.id] = {
                    status: 'idle', // 重启后不会恢复未完成的模型循环。
                    abortController: new AbortController(), // 为下一次运行准备取消入口。
                    clients: new Set(), // SSE 连接只能在当前进程建立。
                    processes: new Set(), // 子进程不会跨重启恢复。
                    permission: new Map(), // 审批等待不会跨重启恢复。
                    events: [], // 流式增量不会写入长期历史。
                }
            }
        }

        await Promise.all([this.save('config'), this.save('workspaces')]) // 补齐缺失默认字段并落盘。
        return this // 启动方可直接继续使用 Store。
    },

    save(domain) {
        const previous = queues.get(domain) || Promise.resolve() // 找到同一文件的上一次写入。
        const current = previous.catch(() => {}).then(async () => {
            if (domain === 'config' || domain === 'workspaces') {
                const path = domain === 'config' ? Path.config() : Path.workspaces() // 选择全局 JSON 文件。
                const value = domain === 'config' ? Store.config : Store.workspaces // 选择对应内存真相。
                await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 }) // 原子写入可读 JSON。
                return chmod(path, 0o600) // 保证旧文件也保持私有权限。
            }

            const session = Store.sessions[domain] // 其他 domain 都按会话 ID 处理。
            if (!session) return // 删除后的迟到保存不能重建会话目录。

            const { messages, ...meta } = session // 元数据和可编辑消息分别保存。
            await mkdir(Path.session(domain), { recursive: true, mode: 0o700 }) // 确保会话目录存在。
            const lines = messages.map(JSON.stringify).join('\n') // 每条消息独占一行 JSONL。
            await writeFile(Path.meta(domain), JSON.stringify(meta, null, 2), { mode: 0o600 }) // 写元数据。
            await writeFile(Path.messages(domain), lines ? `${lines}\n` : '', { mode: 0o600 }) // 写完整历史。
        })
        queues.set(domain, current.catch(() => {})) // 失败不能堵住同一域下一次保存。
        return current // 当前调用仍能收到真实写入错误。
    },

    async broadcast(sessionID, event) {
        const runtime = this.runtimes[sessionID] // 找到此事件所属的连接集合。
        if (!runtime) return // 已删除会话的迟到事件直接丢弃。

        if (event.type === 'data-message') runtime.events = [] // 完整消息落盘后清掉旧增量。
        else if (event.type !== 'data-tool-output') runtime.events.push(event) // 只缓存重连必需事件。

        for (const client of runtime.clients) {
            try {
                client.enqueue(event) // 向每个在线页面发送同一事件。
                if (event.type === 'data-status' && event.data.status === 'idle') client.close() // 空闲即结束流。
            } catch {}
        }

        if (event.type === 'data-status' && event.data.status === 'idle') {
            runtime.clients.clear() // 关闭后不再保留旧连接引用。
            runtime.events = [] // 下一次运行从空事件缓存开始。
        }
    },
}

export default Store // 导出唯一 Store 实例供所有业务模块共享。
