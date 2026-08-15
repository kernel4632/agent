/* 第一条用户消息到达后，用当前会话模型生成标题。 */
export default api => ({ // 工厂只使用内核注入的公开能力。
    name: 'title',
    hooks: {
        'message.append'({ sessionID, message, signal }) {
            // 只有用户文本消息可以触发标题生成。
            if (message.role !== 'user') return // 助手消息和摘要不会重新生成标题。

            const session = api.Session.read(sessionID) // 标题沿用当前会话模型。
            const workspace = api.Store.workspaces[session.workspaceID] // 标题写入侧栏摘要。
            const summary = workspace.sessions.find(item => item.id === sessionID) // 定位当前摘要项。
            const text = message.parts.find(part => part.type === 'text')?.text // 只从文本 part 提取主题。
            if (summary.title || !text) return // 只为第一条有内容的用户消息生成标题。

            const provider = api.Store.config.providers.find(item => item.name === session.provider) // 找到提供商。
            const model = provider?.models.find(item => item.id === session.model) // 找到当前模型。
            if (!provider || !model) return // 未配置模型时不影响主 Agent。

            // 标题独立生成，慢服务不能挡住主 Agent 循环。
            void api.LLM.stream({
                provider, model, // 标题与会话使用同一模型风格。
                messages: [{ role: 'user', content: `Write a concise title. Return only the title.\n\n${text}` }],
                instructions: 'Return plain text without quotes.', signal,
            }).then(result => {
                const title = result.message.parts.find(part => part.type === 'text')?.text?.trim() // 取纯文本标题。
                if (title && !signal?.aborted) return api.Session.update(sessionID, { title }) // 停止后不写迟到标题。
            }).catch(() => {}) // 标题失败永远不影响主任务。
        },
    },
})
