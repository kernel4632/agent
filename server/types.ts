/*
项目共享的数据契约。这里的消息直接沿用 AI SDK UIMessage，运行状态不写进消息。
任何插件和嵌入方都可以从这个文件获得与内核完全一致的类型。
*/
import type { JSONSchema7, LanguageModelUsage, UIMessage, UIMessageChunk } from 'ai'

export type AgentMessage = UIMessage & {
    createdAt?: string
    summary?: true
    usage?: LanguageModelUsage
}

export type ModelConfig = {
    id: string
    contextWindow: number
    maxOutput: number
}

export type ProviderConfig = {
    name: string
    baseURL: string
    key: string
    models: ModelConfig[]
}

export type PermissionRule = {
    tool: string
    match: string
    action: 'allow' | 'ask'
}

export type ConfigData = {
    auth: { username: string; password: string }
    providers: ProviderConfig[]
    prompts: { system: string; tool: string; summary: string }
    retry: { baseDelay: number; factor: number; maxDelay: number }
    context: { compactRatio: number; idleRounds: number }
    permission: PermissionRule[]
    plugins: Record<string, { enabled: boolean; settings?: unknown }>
}

export type SessionSummary = {
    id: string
    title: string
    lastActiveAt: string
}

export type WorkspaceData = {
    id: string
    path: string
    sessions: SessionSummary[]
}

export type SessionData = {
    id: string
    workspaceID: string
    provider: string
    model: string
    messages: AgentMessage[]
}

export type ToolContext = {
    sessionID: string
    messageID: string
    partIndex: number
    signal: AbortSignal
}

export type ToolResult = {
    output: unknown
    stop?: boolean
}

export type AgentTool = {
    name: string
    description: string
    inputSchema: JSONSchema7
    execute(input: unknown, context: ToolContext): Promise<ToolResult> | ToolResult
    toModelOutput?: (output: unknown) => unknown
}

export type PermissionDecision = {
    action: 'allow' | 'deny'
    scope: 'once' | 'always'
    rule?: PermissionRule
}

export type RuntimeData = {
    status: 'idle' | 'running'
    abort: AbortController
    tools: Map<string, { abort(): void }>
    permission: Map<string, (decision: PermissionDecision) => void>
    listeners: Set<(event: UIMessageChunk) => void | Promise<void>>
    lock: Promise<void>
    task?: Promise<void>
}

export type CheckpointPosition = {
    messageID: string
    partIndex: number
}

export type CheckpointEntry = CheckpointPosition & {
    sequence: number
    path: string
    existed: boolean
    snapshot?: string
}

export type HookName =
    | 'plugin.load'
    | 'plugin.unload'
    | 'loop.start'
    | 'loop.end'
    | 'message.append'
    | 'request.before'
    | 'part.stream'
    | 'tool.before'
    | 'tool.after'
    | 'permission.request'

export type PluginModule = {
    name: string
    hooks?: Partial<Record<HookName, (data: any) => unknown | Promise<unknown>>>
    tools?: AgentTool[]
    unload?: () => unknown | Promise<unknown>
}
