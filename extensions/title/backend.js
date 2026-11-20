/*
自动标题：第一次见到用户消息时，截取开头做成标题。已经有不是「新会话」的标题就不再改。
优先走会话扩展的 rename（会推送给前端）；没有会话扩展时只写 meta，并自己推 title.set。
*/

function text(message) {
    const content = message?.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.filter(part => part?.type === 'text' && part.text).map(part => part.text).join(' ')
}

function headline(raw) {
    return raw.replace(/\s+/g, ' ').trim().slice(0, 30)
}

export default ctx => {
    ctx.patch(ctx.Agents, 'callbacks', original => id => {
        const base = original(id)
        const onEvent = base.onEvent
        return {
            ...base,
            onEvent(event) {
                const result = onEvent?.(event)
                if (event.type === 'message' && event.message?.role === 'user') void name(ctx, id, event.message)
                return result
            },
        }
    })
}

async function name(ctx, id, message) {
    const raw = headline(text(message))
    if (!raw) return
    const meta = await ctx.Store.meta(id)
    if (meta.title && meta.title !== '新会话') return
    if (ctx.use('session')?.rename) await ctx.use('session').rename(id, raw)
    else {
        await ctx.Store.touch(id, { title: raw })
        ctx.push(id, 'set', { id, title: raw })
    }
}
