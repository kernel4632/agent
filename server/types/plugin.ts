import type { AgentTool } from './tool.ts'

export type HookName = 'plugin.load' | 'plugin.unload' | 'loop.start' | 'loop.end' | 'message.append' | 'request.before' | 'part.stream' | 'tool.before' | 'tool.after' | 'permission.request'
export type PluginModule = {
    name: string
    hooks?: Partial<Record<HookName, (data: any) => unknown | Promise<unknown>>>
    tools?: AgentTool[]
    unload?: () => unknown | Promise<unknown>
}
