<!--
按字段 type 用原生控件拼出一份设置表。json 用多行文本，失焦时再解析。
-->
<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'

const props = defineProps({ api: { type: Object, required: true }, ids: { type: Array, default: undefined } })
const forms = ref([])
const values = reactive({})
const error = ref('')

function take(key) { return key.split('.').reduce((cursor, part) => cursor?.[part], values) }
function put(key, value) {
    const parts = key.split('.')
    const last = parts.pop()
    let cursor = values
    for (const part of parts) {
        if (cursor[part] == null || typeof cursor[part] !== 'object') cursor[part] = {}
        cursor = cursor[part]
    }
    cursor[last] = value
}

async function load() {
    forms.value = await props.api.op('settings.forms')
    Object.assign(values, await props.api.op('settings.get'))
}

async function change(key, value) {
    error.value = ''
    put(key, value)
    try { Object.assign(values, await props.api.op('settings.set', { key, value })) }
    catch (item) { error.value = item instanceof Error ? item.message : String(item) }
}

function parse(key, text) {
    try { change(key, JSON.parse(text)) } catch (item) { error.value = item instanceof Error ? item.message : String(item) }
}

const shown = computed(() => props.ids?.length ? forms.value.filter(item => props.ids.includes(item.id)) : forms.value)

onMounted(load)
watch(() => props.api, load)
</script>

<template>
  <section class="form">
    <p v-if="error" class="form__error">{{ error }}</p>
    <article v-for="form in shown" :key="form.id" class="form__block">
      <h3 class="form__title">{{ form.title }}</h3>
      <label v-for="field in form.fields" :key="field.key" class="form__row">
        <span class="form__label">{{ field.label }}</span>
        <select v-if="field.type === 'select'" :value="take(field.key) ?? ''" @change="change(field.key, $event.target.value)">
          <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <input v-else-if="field.type === 'boolean'" type="checkbox" :checked="Boolean(take(field.key))" @change="change(field.key, $event.target.checked)">
        <input v-else-if="field.type === 'number'" type="number" :value="take(field.key) ?? ''" @change="change(field.key, Number($event.target.value))">
        <input v-else-if="field.type === 'password'" type="password" :value="take(field.key) ?? ''" @change="change(field.key, $event.target.value)">
        <textarea v-else-if="field.type === 'textarea'" :value="take(field.key) ?? ''" rows="4" @change="change(field.key, $event.target.value)"></textarea>
        <textarea v-else-if="field.type === 'json'" :value="JSON.stringify(take(field.key) ?? null, null, 2)" rows="8" @change="parse(field.key, $event.target.value)"></textarea>
        <input v-else type="text" :value="take(field.key) ?? ''" @change="change(field.key, $event.target.value)">
      </label>
    </article>
  </section>
</template>

<style scoped>
.form { display: grid; gap: 24px; padding: 8px 4px 24px; }
.form__error { color: var(--danger); font-size: 13px; }
.form__block { display: grid; gap: 12px; }
.form__title { margin: 0; font-size: 15px; font-weight: 550; }
.form__row { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
.form__label { color: var(--text); }
.form input, .form select, .form textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 10px; background: var(--surface);
  color: var(--text); padding: 8px 10px; font: inherit;
}
.form input[type=checkbox] { width: auto; justify-self: start; }
</style>
