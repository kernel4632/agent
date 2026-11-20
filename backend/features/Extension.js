/*
扩展的改动记录器：patch 链、便捷登记、扩展之间的正式接口、拔出时撤销。
ctx 不是服务表，只记录这个扩展做过什么；本体固定，扩展从外面织入。

    const remove = Extension.patch(Models, 'resolve', original => (...args) => original(...args))
    const ctx = Extension.scope('todo', { push: Stream.push })
    ctx.tool(path); ctx.op('todo.add', handler); ctx.expose({ ... }); ctx.use('name')
    Extension.revert('todo')   // 撤掉它做过的全部改动
*/

const chains = new Map()
const undos = new Map()
const exposed = new Map()
const ops = new Map()
const errors = new Map()

function mark(owner, error) {
    errors.set(owner, String(error))
}

function restack(target, key) {
    const chain = chains.get(target).get(key)
    target[key] = chain.layers.reduce((below, layer) => {
        const above = layer.wrap(below)
        if (typeof below !== 'function' || typeof above !== 'function') return above
        return (...args) => {
            try {
                const result = above(...args)
                return result instanceof Promise
                    ? result.catch(error => { mark(layer.owner, error); return below(...args) })
                    : result
            } catch (error) {
                mark(layer.owner, error)
                return below(...args)
            }
        }
    }, chain.original)
}

function track(owner, undo) {
    const list = undos.get(owner) ?? []
    list.push(undo)
    undos.set(owner, list)
    return undo
}

export const Extension = {
    errors,

    // 包任意导出对象上的方法。后加载的在外层；返回撤掉这一层的函数。
    patch(target, key, wrap, owner = 'app') {
        if (!(key in target)) throw new Error(`patch 目标不存在：${key}`)
        const table = chains.get(target) ?? new Map()
        chains.set(target, table)
        if (!table.has(key)) table.set(key, { original: target[key], layers: [] })
        const layer = { owner, wrap }
        table.get(key).layers.push(layer)
        restack(target, key)
        return track(owner, () => {
            const chain = table.get(key)
            chain.layers = chain.layers.filter(item => item !== layer)
            restack(target, key)
        })
    },

    // 扩展入口拿到的 ctx：所有便捷写法都落到 patch 或登记上，并记在这个扩展名下。
    scope(name, hooks = {}) {
        errors.delete(name)
        undos.set(name, [])
        const tools = []
        return {
            name,
            patch: (target, key, wrap) => Extension.patch(target, key, wrap, name),
            tool(path) {
                tools.push(path)
                track(name, () => {
                    const index = tools.indexOf(path)
                    if (index >= 0) tools.splice(index, 1)
                })
                hooks.tool?.(path, name)
                return path
            },
            op(opName, handler) {
                if (ops.has(opName)) throw new Error(`动作 ${opName} 已被登记`)
                ops.set(opName, { name, handler })
                track(name, () => ops.delete(opName))
            },
            push(id, event, data) { hooks.push?.(id, `${name}.${event}`, data) },
            expose(api) { exposed.set(name, api); track(name, () => exposed.delete(name)) },
            use(other) { return exposed.get(other) },
            onDispose(fn) { track(name, fn) },
            tools: () => tools,
        }
    },

    // 调用扩展登记的动作。
    async invoke(name, body) {
        const op = ops.get(name)
        if (!op) { const error = new Error(`没有这个动作：${name}`); error.status = 404; throw error }
        return op.handler(body)
    },

    // 撤掉一个扩展的全部改动（逆序），并从登记里拿掉。
    revert(name) {
        for (const undo of (undos.get(name) ?? []).reverse()) {
            try { undo() } catch { /* 收尾失败不挡住其余撤销 */ }
        }
        undos.delete(name)
        errors.delete(name)
    },
}
