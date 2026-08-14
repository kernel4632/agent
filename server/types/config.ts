import type { JSONSchema7 } from 'ai'

export type ModelConfig = { id: string; contextWindow: number; maxOutput: number }
export type ProviderConfig = { name: string; baseURL: string; key: string; models: ModelConfig[] }
export type PermissionRule = { tool: string; match: string; action: 'allow' | 'ask' }
export type ConfigData = {
    auth: { username: string; password: string }
    providers: ProviderConfig[]
    prompts: { system: string; tool: string; summary: string }
    retry: { baseDelay: number; factor: number; maxDelay: number }
    context: { compactRatio: number; idleRounds: number }
    permission: PermissionRule[]
    plugins: Record<string, { enabled: boolean; settings?: unknown }>
}

export type JSONSchema = JSONSchema7
