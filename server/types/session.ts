import type { LanguageModelUsage, UIMessage } from 'ai'

export type AgentMessage = UIMessage & { createdAt?: string; summary?: true; usage?: LanguageModelUsage }
export type SessionSummary = { id: string; title: string; lastActiveAt: string }
export type WorkspaceData = { id: string; path: string; sessions: SessionSummary[] }
export type SessionData = { id: string; workspaceID: string; provider: string; model: string; messages: AgentMessage[] }
