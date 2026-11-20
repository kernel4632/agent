/*
会话：把 Store 里每个 agents/<id> 当成一条会话。列表、搜索、分组、增删改名都走 op，
改名也会推一条 session.rename，好让已打开的页签更新标题。
*/

async function item(Store, id) {
    const meta = await Store.meta(id)
    return { id, title: meta.title || '新会话', group: meta.group || '', updatedAt: meta.updatedAt || 0 }
}

function match(entry, query, group) {
    if (group && entry.group !== group) return false
    if (!query) return true
    const needle = query.trim().toLowerCase()
    return entry.title.toLowerCase().includes(needle) || entry.id.toLowerCase().includes(needle)
}

export default ctx => {
    const { Store, Agents } = ctx
    ctx.expose({
        rename: async (id, title) => {
            const next = await Store.touch(id, { title })
            ctx.push(id, 'rename', { id, title: next.title })
            return item(Store, id)
        },
    })
    ctx.op('session.list', async ({ query, group } = {}) => {
        const all = []
        for (const id of await Store.list()) all.push(await item(Store, id))
        return all.filter(entry => match(entry, query, group)).sort((a, b) => b.updatedAt - a.updatedAt)
    })
    ctx.op('session.create', async ({ title, group } = {}) => {
        const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        await Store.touch(id, { title: title || '新会话', group: group || '' })
        return item(Store, id)
    })
    ctx.op('session.delete', async ({ id }) => {
        await Agents.remove(id)
        return { ok: true }
    })
    ctx.op('session.rename', async ({ id, title }) => ctx.use('session').rename(id, title))
    ctx.op('session.group', async ({ id, group }) => { await Store.touch(id, { group: group || '' }); return item(Store, id) })
}
