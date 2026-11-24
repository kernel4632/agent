<!--
模型供应商：布局照旧前端 ProviderList（RikkaHub SettingProviderPage）。
列表态：胶囊搜索框 + 圆形「添加」钮，下面每个供应商一张卡片（地址、协议、模型数）；点卡片进详情（#/settings/providers/<名字>）。
详情态交给 Provider.vue。整份 providers 用 settings.set 写回；改名时把 models.chat / compact 里的前缀一起改掉。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { Globe02Icon, PlusSignIcon, Search01Icon } from '@hugeicons/core-free-icons'
import Provider from './Provider.vue'

const props = defineProps({
    api: { type: Object, required: true },
    ui: { type: Object, required: true },
    detail: { type: String, default: '' },
    nav: { type: Object, required: true },
})
const ui = props.ui
const Icon = ui.Icon
/** @typedef {{ name: string, baseURL?: string, apiKey?: string, protocol?: string, models?: Array<{ id?: string, name?: string, context?: number, efforts?: Record<string, unknown> }> }} ProviderEntry */
/** @type {import('vue').Ref<Record<string, any> | null>} */
const config = ref(null)
const query = ref('')
const error = ref('')

/** @type {import('vue').ComputedRef<Array<ProviderEntry>>} */
const providers = computed(() => config.value?.providers ?? [])
const filtered = computed(() => {
    const needle = query.value.trim().toLowerCase()
    return providers.value.filter(item => `${item.name} ${item.baseURL ?? ''}`.toLowerCase().includes(needle))
})
const selected = computed(() => providers.value.find(item => item.name === props.detail) ?? null)

async function load() { config.value = await props.api.op('settings.get') }
/** @param {ProviderEntry[]} list */
async function write(list) {
    error.value = ''
    try { config.value = await props.api.op('settings.set', { key: 'providers', value: list }) }
    catch (item) { error.value = item instanceof Error ? item.message : String(item) }
}

async function add() {
    let name = '新供应商'
    for (let index = 2; providers.value.some(item => item.name === name); index++) name = `新供应商 ${index}`
    await write([...providers.value, { name, baseURL: '', apiKey: '', protocol: 'chat', models: [] }])
    props.nav.open(name)
}

/** @param {ProviderEntry} next */
async function update(next) {
    const before = selected.value
    if (!before) return
    if (next.name !== before.name && (!next.name || providers.value.some(item => item.name === next.name))) {
        error.value = next.name ? `已经有叫「${next.name}」的供应商了` : '名称不能为空'
        return
    }
    await write(providers.value.map(item => item === before ? next : item))
    if (next.name === before.name) return
    const current = config.value
    if (!current) return
    const models = { ...current.models }
    for (const task of Object.keys(models)) {
        if (typeof models[task] === 'string' && models[task].startsWith(`${before.name}/`)) models[task] = `${next.name}/${models[task].slice(before.name.length + 1)}`
    }
    config.value = await props.api.op('settings.set', { key: 'models', value: models })
    props.nav.open(next.name)
}

async function remove() {
    await write(providers.value.filter(item => item !== selected.value))
    props.nav.back()
}

onMounted(load)
</script>

<template>
  <p v-if="error" class="providers__error" role="alert">{{ error }}</p>
  <template v-if="!detail">
    <div class="ui-toolbar">
      <label class="ui-search"><Icon :icon="Search01Icon" :size="18" /><input v-model="query" type="search" placeholder="搜索供应商" aria-label="搜索供应商"></label>
      <button type="button" class="ui-btn ui-btn--primary" aria-label="添加供应商" @click="add"><Icon :icon="PlusSignIcon" :size="18" />添加</button>
    </div>
    <p v-if="providers.length" class="ui-hint">{{ query.trim() ? `找到 ${filtered.length} 个` : `${providers.length} 个供应商` }}</p>
    <ui.Card
      v-for="item in filtered" :key="item.name" :icon="Globe02Icon" :title="item.name"
      :subtitle="item.baseURL || '还没填请求地址'" :tags="[item.protocol || 'chat', `${item.models?.length ?? 0} 个模型`, item.apiKey ? '' : '缺少 API Key']"
      @click="nav.open(item.name)"
    />
    <ui.Empty v-if="config && !filtered.length" :icon="query ? Search01Icon : Globe02Icon"
      :title="query ? '没有找到供应商' : '连接你的第一个模型服务'" :text="query ? '换个名字或地址试试' : '点「添加」，再填地址、密钥和模型'" />
  </template>
  <Provider v-else-if="selected" :key="selected.name" :provider="selected" :ui="ui" @update="update" @remove="remove" />
  <ui.Empty v-else-if="config" :icon="Globe02Icon" title="这个供应商已经不在了">
    <button type="button" class="ui-btn" @click="nav.back()">返回供应商列表</button>
  </ui.Empty>
</template>

<style scoped>
.providers__error { margin: 0 0 12px; padding: 10px 14px; border-radius: 12px; background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); font-size: 13px; }
</style>
