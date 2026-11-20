/*
设置页的一套小控件（仿旧前端 SettingsList / SettingsRow / Switch / Field 和 RikkaHub 的分组卡片），给设置页和各扩展的设置分类共用。
kit(Icon) 用组件表里的 Icon 生成一次；设置页把它作为 ui 传给每个分类组件：
    <ui.List title="连接"><ui.Row title="API Key" description="…"><ui.Field type="password" v-model="key" /></ui.Row></ui.List>
    <ui.Card :icon="Globe02Icon" title="relay" subtitle="https://…" :tags="['chat', '3 个模型']" @click="open" />
样式在 css 里，由 index.js 用 app.style 挂一次；手机宽度下行内控件落到标题下面（按 .set__pane 容器宽度）。
*/
import { defineComponent, h } from 'vue'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'

let made = null

export function kit(Icon) {
    if (made) return made
    const tile = (icon, tone) => h('span', { class: ['ui-tile', `ui-tile--${tone || 'plain'}`], 'aria-hidden': 'true' }, [h(Icon, { icon, size: 20 })])
    const chevron = () => h('span', { class: 'ui-chevron' }, [h(Icon, { icon: ArrowRight01Icon, size: 16 })])

    const List = defineComponent({
        props: { title: String, note: String },
        setup: (props, { slots }) => () => h('section', { class: 'ui-list' }, [
            props.title && h('h3', { class: 'ui-list__title' }, props.title),
            h('div', { class: 'ui-list__card' }, slots.default?.()),
            props.note && h('p', { class: 'ui-list__note' }, props.note),
        ]),
    })

    // 一行设置：可带图标，link 时整行是按钮、末尾带箭头；默认插槽是右侧控件。
    const Row = defineComponent({
        props: { title: String, description: String, icon: [Object, Array], tone: String, wide: Boolean, link: Boolean, on: Boolean },
        emits: ['click'],
        setup: (props, { slots, emit }) => () => h(props.link ? 'button' : 'div', {
            class: ['ui-row', { 'ui-row--wide': props.wide, 'ui-row--link': props.link, 'is-on': props.on }],
            type: props.link ? 'button' : undefined,
            onClick: props.link ? () => emit('click') : undefined,
        }, [
            props.icon && tile(props.icon, props.tone),
            h('span', { class: 'ui-row__copy' }, [
                h('span', { class: 'ui-row__title' }, slots.title?.() ?? props.title),
                props.description && h('span', { class: 'ui-row__desc' }, props.description),
            ]),
            slots.default && h('span', { class: 'ui-row__control' }, slots.default()),
            props.link && chevron(),
        ]),
    })

    // 列表里的一张卡片（供应商、MCP 连接）：图标、名字、一行副标题、几个小标签，点开进详情。
    const Card = defineComponent({
        props: { title: String, subtitle: String, icon: [Object, Array], tone: String, tags: Array, off: Boolean },
        emits: ['click'],
        setup: (props, { slots, emit }) => () => h('div', { class: ['ui-card', { 'is-off': props.off }], role: 'button', tabindex: 0, onClick: () => emit('click'), onKeydown: event => event.key === 'Enter' && emit('click') }, [
            props.icon && tile(props.icon, props.tone || 'accent'),
            h('span', { class: 'ui-card__copy' }, [
                h('strong', props.title),
                props.subtitle && h('small', props.subtitle),
                props.tags?.length && h('span', { class: 'ui-tags' }, props.tags.filter(Boolean).map(tag => h('span', tag))),
            ]),
            slots.default && h('span', { class: 'ui-row__control', onClick: event => event.stopPropagation() }, slots.default()),
            chevron(),
        ]),
    })

    const Switch = defineComponent({
        props: { modelValue: Boolean, label: String, disabled: Boolean },
        emits: ['update:modelValue'],
        setup: (props, { emit }) => () => h('label', { class: ['ui-switch', { 'is-disabled': props.disabled }] }, [
            h('input', { type: 'checkbox', role: 'switch', 'aria-label': props.label, checked: props.modelValue, disabled: props.disabled, onChange: event => emit('update:modelValue', event.target.checked) }),
            h('span', { class: 'ui-switch__track' }, [h('span', { class: 'ui-switch__thumb' })]),
        ]),
    })

    // 文本框：失焦或回车才提交，避免每敲一个字就写一次配置。
    const Field = defineComponent({
        props: { modelValue: [String, Number], type: { type: String, default: 'text' }, placeholder: String, label: String },
        emits: ['update:modelValue'],
        setup: (props, { emit }) => () => h('input', {
            class: 'ui-field', type: props.type, value: props.modelValue ?? '', placeholder: props.placeholder, 'aria-label': props.label || props.placeholder,
            autocomplete: props.type === 'password' ? 'off' : undefined, spellcheck: false,
            onChange: event => emit('update:modelValue', props.type === 'number' ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value),
        }),
    })

    const Select = defineComponent({
        props: { modelValue: String, options: { type: Array, default: () => [] }, label: String },
        emits: ['update:modelValue'],
        setup: (props, { emit }) => () => h('select', { class: 'ui-field ui-select', value: props.modelValue ?? '', 'aria-label': props.label, onChange: event => emit('update:modelValue', event.target.value) },
            props.options.map(item => h('option', { value: item.value, selected: item.value === (props.modelValue ?? '') }, item.label))),
    })

    // 分段选择（允许 / 询问 / 拒绝）：每段都是 ≥36px 高的按钮。
    const Segmented = defineComponent({
        props: { modelValue: String, options: { type: Array, default: () => [] }, label: String },
        emits: ['update:modelValue'],
        setup: (props, { emit }) => () => h('span', { class: 'ui-seg', role: 'radiogroup', 'aria-label': props.label }, props.options.map(item => h('button', {
            type: 'button', role: 'radio', 'aria-checked': item.value === props.modelValue, class: { 'is-on': item.value === props.modelValue }, onClick: () => emit('update:modelValue', item.value),
        }, item.label))),
    })

    const Empty = defineComponent({
        props: { icon: [Object, Array], title: String, text: String },
        setup: (props, { slots }) => () => h('div', { class: 'ui-empty' }, [props.icon && h(Icon, { icon: props.icon, size: 32 }), h('strong', props.title), props.text && h('p', props.text), slots.default?.()]),
    })

    made = { Icon, List, Row, Card, Switch, Field, Select, Segmented, Empty }
    return made
}

export { css } from './ui.css.js'
