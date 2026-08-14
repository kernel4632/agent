/*
标题插件：第一个用户消息写入后生成简短标题；没有 IM 会话标题需求时可完全卸载。
*/
import type { AgentMessage, PluginModule } from '../../types.ts'

export default (api: any): PluginModule => ({
    name: 'title',
    hooks: {
        async 'message.append'({ sessionID, message, signal }: { sessionID: string; message: AgentMessage; signal?: AbortSignal }) {
            if (message.role !== 'user') return
            const session = api.Session.read(sessionID)
            const workspace = api.Store.workspaces[session.workspaceID]
            if (workspace.sessions.find((item: any) => item.id === sessionID)?.title) return
            const text = message.parts.find(part => part.type === 'text')?.text
            if (!text) return
            const provider = api.Store.config.providers.find((item: any) => item.name === session.provider)
            const model = provider?.models.find((item: any) => item.id === session.model)
            if (!provider || !model) return
            const result = await api.LLM.chat({
                provider,
                model,
                retry: api.Store.config.retry,
                messages: [{ role: 'user', content: `Write a concise title for this request. Return only the title.\n\n${text}` }],
                instructions: 'Return a plain title with no quotes or explanation.',
            }, { signal })
            const title = result.message.parts.find((part: any) => part.type === 'text')?.text?.trim()
            if (title) await api.Session.rename(sessionID, title)
        },
    },
})
