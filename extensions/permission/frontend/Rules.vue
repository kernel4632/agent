<!--
权限规则（设置页「权限」分类）：一行一个工具，右边是「允许 / 询问 / 拒绝」分段选择；第一行「其他工具」就是 * 默认动作。
按参数细分的规则（对话里点「总是允许」记下的）显示条数，分段选择改的是它的兜底动作，细则保留。
底部可以加一个工具名；除默认行外每行都能删。整份通过 permission.set 写回 config.permission。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { Delete02Icon, PlusSignIcon, Shield01Icon } from '@hugeicons/core-free-icons'

const props = defineProps({ api: { type: Object, required: true }, ui: { type: Object, required: true } })
const ui = props.ui
const Icon = ui.Icon
const rules = ref({})
const name = ref('')
const options = [{ value: 'allow', label: '允许' }, { value: 'ask', label: '询问' }, { value: 'deny', label: '拒绝' }]

const rows = computed(() => Object.keys(rules.value).filter(key => key !== '*').sort())
const action = value => typeof value === 'object' && value ? (value['*'] ?? 'ask') : (value ?? 'ask')
const detail = value => {
    if (!value || typeof value !== 'object') return ''
    const count = Object.keys(value).filter(key => key !== '*').length
    return count ? `另有 ${count} 条按参数的允许规则` : ''
}

async function load() { rules.value = await props.api.op('permission.rules') }
async function write(next) { rules.value = next; await props.api.op('permission.set', { permission: next }) }

function choose(key, value) {
    const current = rules.value[key]
    write({ ...rules.value, [key]: current && typeof current === 'object' ? { ...current, '*': value } : value })
}
function drop(key) {
    const next = { ...rules.value }
    delete next[key]
    write(next)
}
function add() {
    const key = name.value.trim()
    if (!key || key in rules.value) return
    name.value = ''
    write({ ...rules.value, [key]: 'ask' })
}

onMounted(load)
</script>

<template>
  <p class="ui-hint">工具调用前按这里的规则决定：允许直接执行，询问会在对话里弹出确认条，拒绝直接告诉模型不行。</p>
  <ui.List title="默认">
    <ui.Row :icon="Shield01Icon" tone="warn" title="其他工具" description="没有单独规则的工具都按这个处理">
      <ui.Segmented :model-value="action(rules['*'])" :options="options" label="其他工具" @update:model-value="choose('*', $event)" />
    </ui.Row>
  </ui.List>
  <ui.List title="按工具">
    <ui.Row v-for="key in rows" :key="key" :title="key" :description="detail(rules[key])">
      <ui.Segmented :model-value="action(rules[key])" :options="options" :label="key" @update:model-value="choose(key, $event)" />
      <button type="button" class="ui-round hit" :aria-label="`删除 ${key} 的规则`" title="删除规则" @click="drop(key)"><Icon :icon="Delete02Icon" :size="17" /></button>
    </ui.Row>
    <form class="ui-row rules__add" @submit.prevent="add">
      <input v-model="name" class="ui-field" placeholder="工具名，例如 shell" aria-label="工具名" spellcheck="false">
      <button type="submit" class="ui-btn" :disabled="!name.trim()"><Icon :icon="PlusSignIcon" :size="16" />添加</button>
    </form>
  </ui.List>
</template>

<style scoped>
.rules__add { gap: 10px; }
.rules__add .ui-field { flex: 1; width: auto; }
</style>
