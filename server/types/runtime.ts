import type { UIMessageChunk } from 'ai'
import type PQueue from 'p-queue'
import type { PermissionDecision } from './tool.ts'

export type RuntimeData = {
    status: 'idle' | 'running'
    abort: AbortController
    operations: Map<string, AbortController>
    operationTasks: Map<string, Promise<void>>
    permission: Map<string, (decision: PermissionDecision) => void>
    listeners: Set<(event: UIMessageChunk) => void | Promise<void>>
    sink?: (event: UIMessageChunk) => void | Promise<void>
    events: UIMessageChunk[]
    closed: boolean
    sends: PQueue
    writes: PQueue
    task?: Promise<void>
}
export type CheckpointPosition = { messageID: string; partIndex: number }
export type CheckpointEntry = CheckpointPosition & { sequence: number; path: string; existed: boolean; snapshot?: string }
