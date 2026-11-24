/*
自动标题：第一次见到用户消息时，截取开头做成标题。已经有不是「新会话」的标题就不再改。
优先走会话扩展的 rename（会推送给前端）；没有会话扩展时只写 meta，并自己推 title.set。
*/

/** @param {any} message */
function text(message) {
    const content = message?.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.filter(part => part?.type === 'text' && part.text).map(part => part.text).join(' ')
}

/** @param {string} raw */
function headline(raw) {
    return raw.replace(/\s+/g, ' ').trim().slice(0, 30)
}

/** @param {import('agent-backend').Ctx} ctx */
export default ctx => {
    ctx.patch(ctx.Agents, 'callbacks', /** @param {(id: string) => Record<string, any>} original */ original => id => {
        const base = original(id)
        const onEvent = base.onEvent
        return {
            ...base,
            /** @param {any} event */
            onEvent(event) {
                const result = onEvent?.(event)
                if (event.type === 'message' && event.message?.role === 'user') void name(ctx, id, event.message)
                return result
            },
        }
    })
}

/** @param {import('agent-backend').Ctx} ctx @param {string} id @param {any} message */
async function name(ctx, id, message) {
    const raw = headline(text(message))
    if (!raw) return
    const meta = await ctx.Store.meta(id)
    if (meta.title && meta.title !== '新会话') return
    const session = /** @type {{ rename?(id: string, title: string): Promise<unknown> } | undefined} */ (ctx.use('session'))
    if (session?.rename) await session.rename(id, raw)
    else {
        await ctx.Store.touch(id, { title: raw })
        ctx.push(id, 'set', { id, title: raw })
    }
}
