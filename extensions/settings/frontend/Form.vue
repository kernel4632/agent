<!--
数据驱动的设置表：后端扩展用 ctx.use('settings').add({ id, title, fields }) 登记字段，这里按 type 画成设置行。
select / boolean / number / password / text 都是一行（标题在左、控件在右）；textarea / json 是上下排的宽行，失焦时再解析。
ids 只显示其中几张表（例如「模型」页只要 models）。
-->
<script setup>
import { computed, onMounted, reactive, ref } from 'vue'

const props = defineProps({
    api: { type: Object, required: true },
    ui: { type: Object, required: true },
    ids: { type: Array, default: undefined },
})
const ui = props.ui
/** @typedef {{ id: string, title: string, note?: string, fields?: Array<{ key: string, type?: string, label?: string, description?: string, options?: Array<{ value: string, label: string }> }> }} FormEntry */
/** @type {import('vue').Ref<Array<FormEntry>>} */
const forms = ref([])
const values = reactive({})
const error = ref('')

/** @param {string} key */
function take(key) { return key.split('.').reduce((/** @type {Record<string, any>} */ cursor, part) => cursor?.[part], values) }

async function load() {
    forms.value = await props.api.op('settings.forms')
    Object.assign(values, await props.api.op('settings.get'))
}

/** @param {string} key @param {unknown} value */
async function change(key, value) {
    error.value = ''
    try { Object.assign(values, await props.api.op('settings.set', { key, value })) }
    catch (item) { error.value = item instanceof Error ? item.message : String(item) }
}

/** @param {string} key @param {string} text */
function parse(key, text) {
    try { change(key, JSON.parse(text)) } catch (item) { error.value = `JSON 写得不完整：${item instanceof Error ? item.message : item}` }
}

const shown = computed(() => props.ids && props.ids.length ? forms.value.filter(/** @param {FormEntry} item */ item => props.ids && props.ids.includes(item.id)) : forms.value)
/** @param {{ type?: string }} field */
const wide = field => field.type === 'textarea' || field.type === 'json'

onMounted(load)
</script>

<template>
  <div class="form">
    <p v-if="error" class="form__error" role="alert">{{ error }}</p>
    <ui.List v-for="form in shown" :key="form.id" :title="shown.length > 1 ? form.title : ''" :note="form.note">
      <ui.Row v-for="field in form.fields" :key="field.key" :title="field.label" :description="field.description" :wide="wide(field)">
        <ui.Select v-if="field.type === 'select'" :model-value="take(field.key) ?? ''" :options="field.options" :label="field.label" @update:model-value="change(field.key, $event)" />
        <ui.Switch v-else-if="field.type === 'boolean'" :model-value="Boolean(take(field.key))" :label="field.label" @update:model-value="change(field.key, $event)" />
        <ui.Field v-else-if="field.type === 'number' || field.type === 'password'" :type="field.type" :model-value="take(field.key)" :label="field.label" @update:model-value="change(field.key, $event)" />
        <textarea v-else-if="field.type === 'textarea'" class="ui-field form__area" :value="take(field.key) ?? ''" rows="4" @change="change(field.key, $event.target.value)"></textarea>
        <textarea v-else-if="field.type === 'json'" class="ui-field form__area form__code" :value="JSON.stringify(take(field.key) ?? null, null, 2)" rows="8" @change="parse(field.key, $event.target.value)"></textarea>
        <ui.Field v-else :model-value="take(field.key)" :label="field.label" @update:model-value="change(field.key, $event)" />
      </ui.Row>
    </ui.List>
  </div>
</template>

<style scoped>
.form__error { margin: 0 0 12px; padding: 10px 14px; border-radius: 12px; background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); font-size: 13px; }
.form__area { width: 100%; height: auto; padding: 10px 14px; line-height: 1.5; resize: vertical; }
.form__code { font-family: var(--mono); font-size: 12.5px; }
</style>
