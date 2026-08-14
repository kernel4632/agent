import type { JSONSchema7 } from 'ai'
import type { PermissionRule } from './config.ts'

export type ToolOutputEvent = { stream: 'stdout' | 'stderr' | 'output'; data: string }
export type ToolContext = {
    sessionID: string
    messageID: string
    partIndex: number
    signal: AbortSignal
    receive?(event: ToolOutputEvent): void | Promise<void>
    checkpoint?(path: string): void | Promise<void>
    retry?<T>(operation: () => Promise<T>): Promise<T>
}
export type ToolResult = { output: unknown; stop?: boolean }
export type AgentTool = {
    name: string
    description: string
    inputSchema: JSONSchema7
    execute(input: unknown, context: ToolContext): Promise<ToolResult> | ToolResult
    toModelOutput?: (output: unknown) => unknown
    source?: string
    factory?: true
    hosted?: true
}
export type PermissionDecision = { action: 'allow' | 'deny'; scope: 'once' | 'always'; rule?: PermissionRule }
