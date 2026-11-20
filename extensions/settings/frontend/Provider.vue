<!--
一个供应商的详情：照旧前端 ProviderEditor 的分组卡片——连接、模型、危险操作。
每个字段失焦即保存（emit update 整个供应商）；模型一行一个，点铅笔在行内展开 ID / 显示名 / 上下文，点「完成」才写回。
没认出来的字段（思考强度档位、额外 provider 参数等）原样保留，不在这里编辑。
-->
<script setup>
import { ref } from 'vue'
import { AiBrain01Icon, Delete02Icon, PencilEdit02Icon, PlusSignIcon, Tick02Icon } from '@hugeicons/core-free-icons'

const props = defineProps({ provider: { type: Object, required: true }, ui: { type: Object, required: true } })
const emit = defineEmits(['update', 'remove'])
const ui = props.ui
const Icon = ui.Icon
const editing = ref(-1)
const draft = ref({ id: '', name: '', context: undefined })

const protocols = [
    { value: 'chat', label: 'Chat Completions（chat）' },
    { value: 'responses', label: 'Responses（responses）' },
    { value: 'anthropic', label: 'Messages（anthropic）' },
    { value: 'gemini', label: 'Generate Content（gemini）' },
]

function set(key, value) { emit('update', { ...props.provider, [key]: typeof value === 'string' ? value.trim() : value }) }

function edit(index) {
    const model = props.provider.models?.[index] ?? {}
    editing.value = index
    draft.value = { id: model.id ?? '', name: model.name ?? '', context: model.context }
}
function addModel() {
    editing.value = props.provider.models?.length ?? 0
    draft.value = { id: '', name: '', context: undefined }
}
function done() {
    const models = [...(props.provider.models ?? [])]
    const id = draft.value.id.trim()
    if (id) {
        const next = { ...models[editing.value], id, name: draft.value.name.trim() || undefined, context: draft.value.context || undefined }
        models.splice(editing.value, 1, JSON.parse(JSON.stringify(next)))
        set('models', models)
    }
    editing.value = -1
}
function drop(index) { set('models', (props.provider.models ?? []).filter((_, at) => at !== index)) }
function remove() { if (confirm(`删除供应商「${props.provider.name}」和它下面的全部模型？`)) emit('remove') }
const efforts = model => model.efforts ? Object.keys(model.efforts).length : 0
</script>

<template>
  <ui.List title="连接">
    <ui.Row title="名称" description="模型 id 的前缀：名称/模型"><ui.Field :model-value="provider.name" label="名称" @update:model-value="set('name', $event)" /></ui.Row>
    <ui.Row title="请求地址" description="服务给的 API 地址，通常以 /v1 结尾"><ui.Field type="url" :model-value="provider.baseURL" placeholder="https://…/v1" label="请求地址" @update:model-value="set('baseURL', $event)" /></ui.Row>
    <ui.Row title="API Key" description="只保存在本机 config.json"><ui.Field type="password" :model-value="provider.apiKey" placeholder="sk-…" label="API Key" @update:model-value="set('apiKey', $event)" /></ui.Row>
    <ui.Row title="接口协议" description="和服务提供的接口一致"><ui.Select :model-value="provider.protocol || 'chat'" :options="protocols" label="接口协议" @update:model-value="set('protocol', $event)" /></ui.Row>
  </ui.List>

  <ui.List :title="`模型（${provider.models?.length ?? 0}）`" note="在输入框下方的模型选择里出现为「名称/ID」。">
    <template v-for="(model, index) in [...(provider.models ?? []), ...(editing === (provider.models?.length ?? 0) ? [{}] : [])]" :key="index">
      <div v-if="editing === index" class="ui-row model__edit">
        <ui.Field v-model="draft.id" placeholder="模型 ID（必填）" label="模型 ID" />
        <ui.Field v-model="draft.name" placeholder="显示名（可空）" label="显示名" />
        <ui.Field v-model="draft.context" type="number" placeholder="上下文 token" label="上下文" />
        <button type="button" class="ui-btn ui-btn--primary" @click="done"><Icon :icon="Tick02Icon" :size="16" />完成</button>
      </div>
      <ui.Row v-else :icon="AiBrain01Icon" :title="model.name || model.id"
        :description="[model.id, model.context ? `上下文 ${model.context}` : '', efforts(model) ? `思考强度 ${efforts(model)} 档` : ''].filter(Boolean).join(' · ')">
        <button type="button" class="ui-round hit" aria-label="编辑模型" title="编辑" @click="edit(index)"><Icon :icon="PencilEdit02Icon" :size="17" /></button>
        <button type="button" class="ui-round hit" aria-label="删除模型" title="删除" @click="drop(index)"><Icon :icon="Delete02Icon" :size="17" /></button>
      </ui.Row>
    </template>
    <button v-if="editing < 0" type="button" class="ui-row ui-row--link model__add" @click="addModel"><Icon :icon="PlusSignIcon" :size="18" />添加模型</button>
  </ui.List>

  <ui.List title="危险操作">
    <ui.Row title="删除供应商" description="同时移除它下面的全部模型"><button type="button" class="ui-btn ui-btn--danger" @click="remove">删除</button></ui.Row>
  </ui.List>
</template>

<style scoped>
.model__edit { display: grid; grid-template-columns: 1.4fr 1fr 120px auto; gap: 8px; }
.model__edit .ui-field { width: 100%; }
.model__add { justify-content: center; gap: 6px; min-height: 52px; color: var(--muted); font-size: 14px; }
@container pane (max-width: 560px) {
  .model__edit { grid-template-columns: 1fr; }
}
</style>
