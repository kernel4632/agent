/*
Agent 的全部内存数据。Store 只描述数据长什么样，不负责加载、保存或发送事件。
业务指令直接读取和修改这些字段，数据流向不经过隐藏方法。
*/
import type { ConfigData, RuntimeData, SessionData, WorkspaceData } from './types.ts'

const defaults: ConfigData = {
    auth: { username: '', password: '' },
    providers: [],
    prompts: {
        system: 'You are a capable general-purpose agent. Continue until the task is complete, then call finish. If blocked on user input, call ask_user.',
        tool: '',
        summary: 'Summarize the completed work, important decisions, current state, errors, and exact next steps so another model can continue without losing context.',
    },
    retry: { baseDelay: 1000, factor: 2, maxDelay: 60_000 },
    context: { compactRatio: 0.8, idleRounds: 3 },
    permission: [{ tool: '*', match: '*', action: 'ask' }],
    plugins: {},
}

const Store: {
    defaults: ConfigData
    config: ConfigData
    workspaces: Record<string, WorkspaceData>
    sessions: Record<string, SessionData>
    runtimes: Record<string, RuntimeData>
} = {
    defaults,
    config: structuredClone(defaults),
    workspaces: {},
    sessions: {},
    runtimes: {},
}

export default Store
