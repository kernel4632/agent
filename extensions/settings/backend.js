/*
设置：只汇总各扩展登记的表单描述，并负责整份读写 config.json。
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
            { key: 'models.chat', type: 'select', label: '对话模型', options: models },
            { key: 'models.compact', type: 'select', label: '压缩模型', options: [{ value: '', label: '（与对话相同）' }, ...models] },
        ],
    })
    ctx.op('settings.forms', async () => {
        const config = await ctx.Store.config()
        const models = ctx.Models.list(config).map(item => ({ value: item.id, label: item.name }))
        return forms.map(form => ({ ...form, fields: typeof form.fields === 'function' ? form.fields(config, models) : form.fields }))
    })
    ctx.op('settings.get', () => ctx.Store.config())
    ctx.op('settings.set', async ({ key, value }) => ctx.Store.configure(set(await ctx.Store.config(), key, value)))
    ctx.op('settings.save', ({ config }) => ctx.Store.configure(config))
    ctx.op('settings.toggle', async ({ name, enabled }) => ctx.Loader.toggle(name, enabled))
    ctx.op('settings.extensions', () => ctx.Loader.list())
}
