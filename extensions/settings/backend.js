/*
设置：汇总各扩展登记的表单描述（字段带 type / label / description），并负责读写 config.json。
供应商列表不走表单，由前端的结构化编辑器整份写 providers。
其他扩展通过 ctx.use('settings').add(...) 追加一项；字段 key 用点号路径指向配置里的位置。
*/

function get(data, key) {
    return key.split('.').reduce((cursor, part) => cursor?.[part], data)
}

function set(data, key, value) {
    const parts = key.split('.')
    const last = parts.pop()
    let cursor = data
    for (const part of parts) {
        if (cursor[part] == null || typeof cursor[part] !== 'object') cursor[part] = {}
        cursor = cursor[part]
    }
    cursor[last] = value
    return data
}

export default ctx => {
    const forms = []
    const api = {
        add(form) { forms.push(form) },
        list() { return forms },
        get,
    }
    ctx.expose(api)
    api.add({
        id: 'models',
        title: '模型',
        fields: (_config, models) => [
            { key: 'models.chat', type: 'select', label: '对话模型', description: '新对话默认用它；已有对话可在输入框下方单独切换', options: [{ value: '', label: '（未选择）' }, ...models] },
            { key: 'models.compact', type: 'select', label: '压缩模型', description: '上下文快满时用来写总结', options: [{ value: '', label: '和对话模型相同' }, ...models] },
        ],
    })
    async function refresh(config) {
        for (const current of ctx.Agents.all()) {
            current.models = ctx.Models.list(config)
            const modelId = current.model || config.models?.chat
            if (!modelId) continue
            try {
                current.agent.config = { ...current.agent.config, ...ctx.Models.resolve(config, modelId, current.effort) }
                current.model = modelId
                current.fault = ''
            } catch (error) { current.fault = error.message ?? String(error) }
        }
        return config
    }
    ctx.op('settings.forms', async () => {
        const config = await ctx.Store.config()
        const models = ctx.Models.list(config).map(item => ({ value: item.id, label: item.name }))
        return forms.map(form => ({ ...form, fields: typeof form.fields === 'function' ? form.fields(config, models) : form.fields }))
    })
    ctx.op('settings.get', () => ctx.Store.config())
    ctx.op('settings.set', async ({ key, value }) => refresh(await ctx.Store.configure(set(await ctx.Store.config(), key, value))))
    ctx.op('settings.save', async ({ config }) => refresh(await ctx.Store.configure(config)))
    ctx.op('settings.toggle', async ({ name, enabled }) => ctx.Loader.toggle(name, enabled))
    ctx.op('settings.extensions', () => ctx.Loader.list())
}
