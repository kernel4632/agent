/*
权限审批：patch Agents.callbacks，加上 onPermission。没装这个扩展时，core 不传回调，工具直接执行。
规则存在 config.permission：键是工具名，值是 allow / deny / ask，或一张「参数模式 → 动作」表。
`*` 是默认动作。问的时候推 permission.ask，等 permission.answer；页面刷新时快照里带上还在等的请求。
*/

/** @type {Record<string, string>} */
const DEFAULTS = { '*': 'ask', read_file: 'allow', list_dir: 'allow', finish: 'allow' }
/** @type {Map<string, { id: string, call: ToolCallInfo, resolve: (allow: boolean) => void }>} */
const pending = new Map()

/** @typedef {Record<string, string | Record<string, string>>} Rules */
/** @typedef {{ toolName: string, input?: unknown }} ToolCallInfo */

/** @param {unknown} value */
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

/**
 * 通配符匹配：* 匹配任意一段（含空），其余字符按字面。参数被拍平成一段文本后整体匹配。
 * @param {string} text
 * @param {string} pattern
 */
function wildcard(text, pattern) {
    if (pattern === '*') return true
    const source = `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
    return new RegExp(source, 's').test(text)
}

/** @param {unknown} value @returns {'allow' | 'deny' | 'ask'} */
function normalize(value) {
    return value === 'allow' || value === 'deny' ? value : 'ask'
}

/** @param {string} toolName @param {unknown} input @param {Record<string, unknown>} rules @returns {'allow' | 'deny' | 'ask'} */
function decide(toolName, input, rules) {
    let action = normalize(rules['*'])
    const rule = rules[toolName]
    if (typeof rule === 'string') action = normalize(rule)
    else if (rule && typeof rule === 'object') {
        const table = /** @type {Record<string, unknown>} */ (rule)
        if ('*' in table) action = normalize(table['*'])
        const text = flatten(input)
        for (const [pattern, value] of Object.entries(table)) {
            if (pattern !== '*' && wildcard(text, pattern)) action = normalize(value)
        }
    }
    return action
}

/** @param {import('agent-backend').Ctx} ctx @param {string} id @param {ToolCallInfo} call */
function ask(ctx, id, call) {
    const requestId = crypto.randomUUID()
    return new Promise(resolve => {
        pending.set(requestId, { id, call, resolve })
        ctx.push(id, 'ask', { requestId, call })
    })
}

/** @param {import('agent-backend').Ctx} ctx @param {{ id: string, call: ToolCallInfo, resolve: (allow: boolean) => void }} item */
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

/** @param {import('agent-backend').Ctx} ctx */
export default ctx => {
    ctx.patch(ctx.Agents, 'callbacks', /** @param {(id: string) => Record<string, unknown>} original */ original => id => {
        const base = original(id)
        return {
            ...base,
            /** @param {ToolCallInfo} call */
            async onPermission(call) {
                const rules = /** @type {Record<string, unknown>} */ ({ ...DEFAULTS, ...(await ctx.Store.config()).permission })
                const action = decide(call.toolName, call.input, rules)
                if (action === 'allow') return true
                if (action === 'deny') return false
                return ask(ctx, id, call)
            },
        }
    })
    ctx.patch(ctx.Agents, 'snapshot', /** @param {(id: string) => Record<string, unknown>} original */ original => id => {
        const asks = [...pending.entries()].filter(([, item]) => item.id === id).map(([requestId, item]) => ({ requestId, call: item.call }))
        return { ...original(id), permission: asks }
    })
    ctx.patch(ctx.Agents, 'stop', /** @param {(id: string) => Promise<unknown>} original */ original => async id => {
        for (const [requestId, item] of [...pending]) if (item.id === id) { item.resolve(false); pending.delete(requestId) }
        return original(id)
    })
    ctx.op('permission.answer', async (/** @type {{ requestId: string, allow?: boolean, always?: boolean }} */ { requestId, allow, always }) => {
        const item = pending.get(requestId)
        if (!item) return { ok: false }
        pending.delete(requestId)
        if (always && allow) await remember(ctx, item)
        item.resolve(Boolean(allow))
        ctx.push(item.id, 'answered', { requestId, allow: Boolean(allow) })
        return { ok: true }
    })
    ctx.op('permission.rules', async () => /** @type {Record<string, unknown>} */ ({ ...DEFAULTS, ...(await ctx.Store.config()).permission }))
    ctx.op('permission.set', async (/** @type {{ permission: Record<string, unknown> }} */ { permission }) => {
        const config = await ctx.Store.config()
        return ctx.Store.configure({ ...config, permission })
    })
    ctx.onDispose(() => { for (const item of pending.values()) item.resolve(false); pending.clear() })
}
