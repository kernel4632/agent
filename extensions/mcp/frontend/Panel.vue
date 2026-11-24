<!--
MCP 服务（设置页分类）：照旧前端 MCPList / MCPEditor。列表态每条连接一张卡片（名字、地址、传输方式），右边是启用开关；
点卡片进详情（#/settings/mcp/<名字>）：名字、地址、传输方式、启用和删除，字段失焦即保存；headers 等其他字段原样保留。
列表整份用 mcp.save 写回 config.mcp。开关时如果当前有打开的会话，就让那个 Agent 立刻连上或断开（mcp.open / close）。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { Plug01Icon, PlusSignIcon } from '@hugeicons/core-free-icons'

const props = defineProps({
    app: { type: Object, required: true },
    ui: { type: Object, required: true },
    detail: { type: String, default: '' },
    nav: { type: Object, required: true },
})
const ui = props.ui
const Icon = ui.Icon
/** @typedef {{ name: string, url?: string, transport?: string, enabled?: boolean, headers?: Record<string, string> }} McpEntry */
/** @type {import('vue').Ref<Array<McpEntry> | null>} */
const list = ref(null)
const error = ref('')
const selected = computed(() => list.value?.find(item => item.name === props.detail) ?? null)
const transports = [{ value: 'http', label: 'Streamable HTTP（http）' }, { value: 'sse', label: 'Server-Sent Events（sse）' }]

async function load() { list.value = (await props.app.api.op('mcp.list', { id: props.app.api.id() })).list ?? [] }
/** @param {McpEntry[]} next */
async function save(next) {
    error.value = ''
    try { list.value = await props.app.api.op('mcp.save', { mcp: next }) }
    catch (item) { error.value = item instanceof Error ? item.message : String(item) }
}

/** @param {McpEntry} item @param {boolean} enabled */
async function toggle(item, enabled) {
    const id = props.app.api.id()
    error.value = ''
    try {
        if (id && item.url) await props.app.api.op(enabled ? 'mcp.open' : 'mcp.close', { id, name: item.name })
        else await save((list.value ?? []).map(one => one === item ? { ...one, enabled } : one))
        await load()
    } catch (err) { error.value = err instanceof Error ? err.message : String(err) }
}

async function add() {
    let name = 'mcp'
    for (let index = 2; list.value?.some(item => item.name === name); index++) name = `mcp-${index}`
    await save([...(list.value ?? []), { name, url: '', transport: 'http', enabled: false }])
    props.nav.open(name)
}

/** @param {McpEntry} next */
async function update(next) {
    const current = selected.value
    if (!current) return
    if (next.name !== current.name && (!next.name || list.value?.some(item => item.name === next.name))) {
        error.value = next.name ? `已经有叫「${next.name}」的连接了` : '名称不能为空'
        return
    }
    const before = current.name
    await save((list.value ?? []).map(item => item.name === before ? next : item))
    if (next.name !== before) props.nav.open(next.name)
}

/** @param {string} key @param {string | boolean} value */
function set(key, value) {
    const current = selected.value
    if (!current) return
    update({ ...current, [key]: typeof value === 'string' ? value.trim() : value })
}

async function remove() {
    const current = selected.value
    if (!current) return
    if (!confirm(`删除 MCP 连接「${current.name}」？`)) return
    await save((list.value ?? []).filter(item => item !== current))
    props.nav.back()
}

onMounted(load)
</script>

<template>
  <p v-if="error" class="mcp__error" role="alert">{{ error }}</p>
  <template v-if="!detail">
    <div class="ui-toolbar">
      <p class="ui-hint mcp__hint">连接外部工具和数据服务（MCP）。开着的连接会在每个会话里出现为工具。</p>
      <button type="button" class="ui-btn ui-btn--primary" @click="add"><Icon :icon="PlusSignIcon" :size="18" />添加</button>
    </div>
    <ui.Card
      v-for="item in list ?? []" :key="item.name" :icon="Plug01Icon" :title="item.name" :off="item.enabled === false"
      :subtitle="item.url || '还没填地址'" :tags="[item.transport || 'http', item.enabled === false ? '已停用' : '已启用']" @click="nav.open(item.name)"
    >
      <ui.Switch :model-value="item.enabled !== false" :disabled="!item.url" :label="`启用 ${item.name}`" @update:model-value="toggle(item, $event)" />
    </ui.Card>
    <ui.Empty v-if="list && !list.length" :icon="Plug01Icon" title="还没有 MCP 连接" text="点「添加」，填上服务地址" />
  </template>
  <template v-else-if="selected">
    <ui.List title="连接">
      <ui.Row title="启用" description="关掉后保留配置，但不会连接">
        <ui.Switch :model-value="selected.enabled !== false" :disabled="!selected.url" label="启用" @update:model-value="set('enabled', $event)" />
      </ui.Row>
      <ui.Row title="名称" description="工具名会带上这个前缀"><ui.Field :model-value="selected.name" label="名称" @update:model-value="set('name', $event)" /></ui.Row>
      <ui.Row title="地址" description="MCP 服务的 URL"><ui.Field type="url" :model-value="selected.url" placeholder="https://…/mcp" label="地址" @update:model-value="set('url', $event)" /></ui.Row>
      <ui.Row title="传输方式" description="和服务端支持的方式一致"><ui.Select :model-value="selected.transport || 'http'" :options="transports" label="传输方式" @update:model-value="set('transport', $event)" /></ui.Row>
    </ui.List>
    <ui.List title="危险操作">
      <ui.Row title="删除连接" description="从配置里移除这条 MCP 连接"><button type="button" class="ui-btn ui-btn--danger" @click="remove">删除</button></ui.Row>
    </ui.List>
  </template>
  <ui.Empty v-else-if="list" :icon="Plug01Icon" title="这条连接已经不在了"><button type="button" class="ui-btn" @click="nav.back()">返回列表</button></ui.Empty>
</template>

<style scoped>
.mcp__error { margin: 0 0 12px; padding: 10px 14px; border-radius: 12px; background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); font-size: 13px; }
.mcp__hint { flex: 1; margin: 0; }
</style>
