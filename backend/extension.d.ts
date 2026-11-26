/*
扩展后端协议的类型：backend.js 的 default(ctx) 收到的对象（features/Extension.js 的 scope 返回值）。
扩展代码是 JS，在 JSDoc 里引用，名字 'agent-backend' 由 backend/tsconfig.extensions.json 的 paths 映射到这里：

    /** @param {import('agent-backend').Ctx} ctx *\
    export default ctx => { ... }

形状与 features/Extension.js 的 scope() / server.js 的 wire() 逐一对齐，改实现时同步这里。
targets 只列扩展实际用到的方法；完整实现见各自源文件。为了让声明文件独立，这里不 import 源码，
Store / Agents 用最小结构描述（方法签名与源文件一致）。
*/

/** meta.json：标题、分组、模型、思考强度、学到的比例、更新时间。 */
export interface AgentMeta { title?: string, group?: string, model?: string, effort?: string, updatedAt?: number, [key: string]: unknown }

/** config.json 的形状（扩展常用字段）。 */
export interface AppConfig {
    providers?: Array<Record<string, unknown>>
    models?: { chat?: string, compact?: string, [key: string]: unknown }
    mcp?: Array<Record<string, unknown>>
    permission?: Record<string, unknown>
    extensions?: { disabled?: string[] }
    skills?: { disabled?: string[] }
    [key: string]: unknown
}

/** 一个已打开的 Agent 实例（Agents.all() 的元素）。 */
export interface AgentCurrent {
    agent: {
        history: Array<Record<string, unknown>>
        tools: string[]
        config: Record<string, any>
        MCP: { list: Array<{ name: string, enabled?: boolean }>, open(name: string): Promise<unknown>, close(name: string): Promise<unknown> }
        ratios?: Record<string, unknown>
        contextRatio?: number
        stop(): Promise<unknown>
        send(input?: unknown, callbacks?: Record<string, unknown>): Promise<unknown>
        compact(callbacks?: Record<string, unknown>): Promise<unknown>
    }
    model: string
    effort?: string
    models: Array<Record<string, unknown>>
    fault: string
}

/** Store：AGENT_HOME 里的配置、meta、历史读写（方法签名见 features/Store.js）。 */
export interface StoreApi {
    home(): string
    config(): Promise<AppConfig>
    configure(data: AppConfig): Promise<AppConfig>
    ensure(id: string): Promise<void>
    meta(id: string): Promise<AgentMeta>
    touch(id: string, patch: Record<string, unknown>): Promise<AgentMeta>
    history(id: string): Promise<Array<Record<string, unknown>>>
    appendHistory(id: string, message: Record<string, unknown>): Promise<void>
    rewriteHistory(id: string, history: Array<Record<string, unknown>>): Promise<void>
    list(): Promise<string[]>
    remove(id: string): Promise<void>
}

/** Agents：打开、发送、停止、压缩、截断历史（方法签名见 features/Agents.js）。 */
export interface AgentsApi {
    setup(next: Record<string, unknown>): void
    all(): AgentCurrent[]
    open(id: string): Promise<AgentCurrent>
    get(id: string): AgentCurrent | undefined
    done(id: string): Promise<unknown>
    running(id: string): boolean
    snapshot(id: string): Record<string, any>
    callbacks(id: string): Record<string, any>
    send(id: string, body: { input?: unknown, cut?: string }): Promise<void>
    compact(id: string): Promise<void>
    stop(id: string): Promise<unknown>
    configure(id: string, patch: { model?: string, effort?: string }): Promise<{ model: string, effort?: string }>
    cut(id: string, messageId: string, held?: boolean): Promise<void>
    drop(id: string): void
    remove(id: string): Promise<void>
}

/** Models：供应商/模型 → agent-core 连接参数（方法签名见 features/Models.js）。 */
export interface ModelsApi {
    list(config: AppConfig): Array<{ id: string, name: string, context?: number, efforts?: string[] }>
    resolve(config: AppConfig, id: string, effort?: string): Record<string, unknown>
}

/** Loader：扫描、拓扑、启停扩展（方法签名见 features/Loader.js）。 */
export interface LoaderApi {
    start(options?: { roots?: string[], disabled?: string[] }): Promise<Array<Record<string, any>>>
    stop(name: string): void
    list(): Array<Record<string, any>>
    entries(): Array<{ name: string, url: string }>
    inspect(): Record<string, any>
    toggle(name: string, enabled: boolean): Promise<Array<Record<string, any>>>
    bundle(name: string): Promise<string | null>
    reset(): void
    roots(): string[]
    hook(next: Record<string, unknown>): void
    scan(roots?: string[]): Promise<Array<Record<string, any>>>
}

/** Extension：登记表（方法签名见 features/Extension.js）。 */
export interface ExtensionApi {
    invoke(name: string, body?: unknown): Promise<unknown>
    paths(): string[]
    inspect(): Record<string, any>
    revert(name: string): void
    patch<T extends object>(target: T, key: string, wrap: (original: any) => any, owner?: string): () => void
}

/** Stream：SSE 推送（方法签名见 features/Stream.js）。扩展一般只用 ctx.push。 */
export interface StreamApi {
    subscribe(id: string, send: (name: string, data: unknown) => void): () => void
    emit(id: string, name: string, data: unknown): void
    add(id: string, event: unknown): void
    tail(id: string): unknown[]
    retryDeadline(id: string): number | undefined
    clear(id: string): void
}

// server.js 的 wire() 注入给 Loader 的 targets；hooks.push / tool / untool 由 wire 实现内部使用。
export interface Ctx {
    name: string
    Agents: AgentsApi
    Stream: StreamApi
    Store: StoreApi
    Models: ModelsApi
    Extension: ExtensionApi
    Loader: LoaderApi
    /** 包任意导出对象上的方法，后加载的在外层；返回撤掉这一层的函数。 */
    patch<T extends object>(target: T, key: string, wrap: (original: any) => (...args: any[]) => any): () => void
    /** 登记一个工具文件路径，挂到每个 Agent。返回路径。 */
    tool(path: string): string
    /** 登记一个动作（POST /api/op/:name）。名字冲突会抛错。 */
    op<T = unknown, R = unknown>(name: string, handler: (body: T) => R | Promise<R>): void
    /** 给这个会话推一条 <扩展名>.<事件> 帧，前端 app.on('<扩展名>.<事件>') 收到。 */
    push(id: string, event: string, data?: unknown): void
    /** 把接口挂给其他扩展 ctx.use('<名字>') 取。 */
    expose(api: Record<string, unknown>): void
    /** 取别的扩展 expose 的接口；对方没启动时是 undefined。 */
    use(other: string): Record<string, unknown> | undefined
    /** 登记拔出时的收尾（关 pending、清定时器）；revert 时逆序调用。 */
    onDispose(fn: () => void): void
    /** 这个扩展登记的工具文件路径。 */
    tools(): string[]
}
