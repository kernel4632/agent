/* 第一条用户消息到达后，用当前会话模型生成标题。 */
export default api => ({
    name: 'title',
    hooks: {
        'message.append'({ sessionID, message, signal }) {
            // 只有用户文本消息可以触发标题生成。
            if (message.role !== 'user') return

            const session = api.Session.read(sessionID)
            const workspace = api.Store.workspaces[session.workspaceID]
            const summary = workspace.sessions.find(item => item.id === sessionID)
            const text = message.parts.find(part => part.type === 'text')?.text
            if (summary.title || !text) return

            const provider = api.Store.config.providers.find(item => item.name === session.provider)
            const model = provider?.models.find(item => item.id === session.model)
            if (!provider || !model) return

            // 标题独立生成，慢服务不能挡住主 Agent 循环。
            void api.LLM.stream({
                provider, model,
                messages: [{ role: 'user', content: `Write a concise title. Return only the title.\n\n${text}` }],
                instructions: 'Return plain text without quotes.', signal,
            }).then(result => {
                const title = result.message.parts.find(part => part.type === 'text')?.text?.trim()
                if (title && !signal?.aborted) return api.Session.update(sessionID, { title })
            }).catch(() => {})
        },
    },
})
