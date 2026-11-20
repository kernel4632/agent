/*
设置：登记面板和加号菜单，并用 Host 包住 App，从右侧打开面板。
*/

import { defineComponent, h, onMounted, ref } from 'vue'
import Form from './Form.vue'
import Host from './Host.vue'

const Extensions = defineComponent({
    props: { api: { type: Object, required: true } },
    setup(props) {
        const items = ref([])
        const load = async () => { items.value = await props.api.op('settings.extensions') }
        const toggle = async (name, enabled) => { await props.api.op('settings.toggle', { name, enabled }); await load() }
        onMounted(load)
        return () => h('section', { class: 'form__block' }, [
            h('h3', { class: 'form__title' }, '扩展'),
            ...items.value.map(item => h('label', { class: 'form__row', style: 'display:flex;align-items:center;justify-content:space-between;', key: item.name }, [
                h('span', { class: 'form__label' }, `${item.name}${item.error ? `（${item.error}）` : ''}`),
                h('input', { type: 'checkbox', checked: item.error !== '已关闭', onChange: ev => toggle(item.name, ev.target.checked) }),
            ])),
        ])
    },
})

const Page = defineComponent({
    props: { api: Object },
    setup(props) {
        return () => h('div', { class: 'settings' }, [
            h(Form, { api: props.api }),
            h(Extensions, { api: props.api }),
        ])
    },
})

export default app => {
    app.shared.panel = ref('')
    app.shared.openPanel = id => { app.shared.panel.value = id }
    app.panels.add({ id: 'settings', title: '设置', component: Page })
    app.plus.add({ id: 'settings', label: '设置', run: () => app.shared.openPanel('settings') })
    app.components.wrap('App', Original => defineComponent({
        setup: () => () => h(Host, { app, original: Original }),
    }))
}
