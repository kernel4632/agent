/*
权限审批：patch Agents.callbacks，加上 onPermission。没装这个扩展时，core 不传回调，工具直接执行。
规则存在 config.permission：键是工具名，值是 allow / deny / ask，或一张「参数模式 → 动作」表。
`*` 是默认动作。问的时候推 permission.ask，等 permission.answer；页面刷新时快照里带上还在等的请求。
*/

const DEFAULTS = { '*': 'ask', read_file: 'allow', list_dir: 'allow', finish: 'allow' }
const pending = new Map()

function flatten(value) {
    const parts = []
    const queue = [value]
    while (queue.length) {
        const current = queue.shift()
        if (Array.isArray(current)) queue.push(...current)
        else if (current && typeof current === 'object') queue.push(...Object.values(current))
        else if (current != null) parts.push(String(current))
    }
    return parts.join(' ')
}

function wildcard(text, pattern) {
    if (pattern === '*') return true
    const source = `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
    return new RegExp(source, 's').test(text)
}

function normalize(value) {
    return value === 'allow' || value === 'deny' ? value : 'ask'
}

function decide(toolName, input, rules) {
    let action = normalize(rules['*'])
    const rule = rules[toolName]
    if (typeof rule === 'string') action = normalize(rule)
    else if (rule && typeof rule === 'object') {
        if ('*' in rule) action = normalize(rule['*'])
        const text = flatten(input)
        for (const [pattern, value] of Object.entries(rule)) {
            if (pattern !== '*' && wildcard(text, pattern)) action = normalize(value)
        }
    }
    return action
}

function ask(ctx, id, call) {
    const requestId = crypto.randomUUID()
    return new Promise(resolve => {
        pending.set(requestId, { id, call, resolve })
        ctx.push(id, 'ask', { requestId, call })
    })
}

async function remember(ctx, item) {
    const config = await ctx.Store.config()
    const permission = { ...DEFAULTS, ...config.permission }
    const text = flatten(item.call.input)
    const current = permission[item.call.toolName]
    if (!text || text.length > 200) permission[item.call.toolName] = 'allow'
    else if (current && typeof current === 'object') permission[item.call.toolName] = { ...current, [text]: 'allow' }
    else permission[item.call.toolName] = { '*': current ?? 'ask', [text]: 'allow' }
    await ctx.Store.configure({ ...config, permission })
}

export default ctx => {
    ctx.patch(ctx.Agents, 'callbacks', original => id => {
        const base = original(id)
        return {
            ...base,
            async onPermission(call) {
                const rules = { ...DEFAULTS, ...(await ctx.Store.config()).permission }
                const action = decide(call.toolName, call.input, rules)
                if (action === 'allow') return true
                if (action === 'deny') return false
                return ask(ctx, id, call)
            },
        }
    })
    ctx.patch(ctx.Agents, 'snapshot', original => id => {
        const asks = [...pending.entries()].filter(([, item]) => item.id === id).map(([requestId, item]) => ({ requestId, call: item.call }))
        return { ...original(id), permission: asks }
    })
    ctx.patch(ctx.Agents, 'stop', original => async id => {
        for (const [requestId, item] of [...pending]) if (item.id === id) { item.resolve(false); pending.delete(requestId) }
        return original(id)
    })
    ctx.op('permission.answer', async ({ requestId, allow, always }) => {
        const item = pending.get(requestId)
        if (!item) return { ok: false }
        pending.delete(requestId)
        if (always && allow) await remember(ctx, item)
        item.resolve(Boolean(allow))
        ctx.push(item.id, 'answered', { requestId, allow: Boolean(allow) })
        return { ok: true }
    })
    ctx.op('permission.rules', async () => ({ ...DEFAULTS, ...(await ctx.Store.config()).permission }))
    ctx.op('permission.set', async ({ permission }) => {
        const config = await ctx.Store.config()
        return ctx.Store.configure({ ...config, permission })
    })
    ctx.use('settings')?.add({
        id: 'permission',
        title: '权限',
        fields: () => [{ key: 'permission', type: 'json', label: '审批规则（allow / ask / deny）' }],
    })
    ctx.onDispose(() => { for (const item of pending.values()) item.resolve(false); pending.clear() })
}
