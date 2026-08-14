/* 第一条用户消息到达后，用当前会话模型生成标题。 */
export default api => ({
    name: 'title',
    hooks: {
        async 'message.append'({ sessionID, message, signal }) {
            if (message.role !== 'user') return
            const session = api.Session.read(sessionID)
            const summary = api.Store.workspaces[session.workspaceID].sessions.find(item => item.id === sessionID)
            const text = message.parts.find(part => part.type === 'text')?.text
            if (summary.title || !text) return
            const provider = api.Store.config.providers.find(item => item.name === session.provider)
            const model = provider?.models.find(item => item.id === session.model)
            if (!provider || !model) return
            try {
                const result = await api.LLM.stream({
                    provider, model,
                    messages: [{ role: 'user', content: `Write a concise title. Return only the title.\n\n${text}` }],
                    instructions: 'Return plain text without quotes.', signal,
                })
                const title = result.message.parts.find(part => part.type === 'text')?.text?.trim()
                if (title) await api.Session.update(sessionID, { title })
            } catch { /* 标题失败不能阻断主任务。 */ }
        },
    },
})
