<!--
MCP 服务管理：展示已配置的 MCP 服务连接，支持编辑、删除和启用/禁用。
设计思想：左侧列表选择，右侧编辑面板修改详情，与供应商配置保持一致的交互模式。
核心数据：mcp（MCP 配置数组，每项含 id、name、command、enabled、definition）。
调用示例：<MCPSettings v-model:mcp="settingsDraft.mcp" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'

const props = defineProps({
  mcp: { type: Array, required: true },
})
const emit = defineEmits(['update:mcp'])

const selectedID = ref(props.mcp[0]?.id ?? '')
const selectedItem = computed(() => props.mcp.find(item => item.id === selectedID.value) ?? null)
const remote = computed(() => ['sse', 'http'].includes(selectedItem.value?.definition?.transport))
const deleteDialog = ref(null)

function requestRemove() {
  deleteDialog.value?.showModal()
}

function addMCP() {
  let number = props.mcp.length + 1
  while (props.mcp.some(item => item.name === `MCP ${number}`)) number += 1
  const id = crypto.randomUUID()
  emit('update:mcp', [...props.mcp, {
    id,
    name: `MCP ${number}`,
    command: '',
    enabled: true,
    definition: { transport: 'stdio', args: [], env: {} },
  }])
  selectedID.value = id
}

function removeMCP() {
  const index = props.mcp.findIndex(item => item.id === selectedID.value)
  if (index < 0) return
  const nextItem = props.mcp[index + 1] ?? props.mcp[index - 1]
  emit('update:mcp', props.mcp.filter(item => item.id !== selectedID.value))
  selectedID.value = nextItem?.id ?? ''
  deleteDialog.value?.close()
}

function updateField(field, value) {
  const updated = props.mcp.map(item => item.id === selectedID.value
    ? { ...item, [field]: value }
    : item)
  emit('update:mcp', updated)
}

function updateDefinition(field, value) {
  const updated = props.mcp.map(item => item.id === selectedID.value
    ? { ...item, definition: { ...item.definition, [field]: value } }
    : item)
  emit('update:mcp', updated)
}

function toggleEnabled() {
  if (!selectedItem.value) return
  updateField('enabled', !selectedItem.value.enabled)
}

function tryUpdateEnv(text) {
  try {
    const env = JSON.parse(text)
    if (typeof env === 'object' && env !== null) updateDefinition('env', env)
  } catch { /* JSON 不完整时不更新 */ }
}

watch(() => props.mcp.map(item => item.id), (ids, previousIDs) => {
  const addedID = ids.find(id => !previousIDs.includes(id))
  if (addedID) selectedID.value = addedID
  else if (!ids.includes(selectedID.value)) selectedID.value = ids[0] ?? ''
})
</script>

<template>
  <section class="mcp-settings" aria-label="MCP 服务">
    <aside class="mcp-list">
      <header class="mcp-list__head">
        <span>服务列表</span>
        <button type="button" class="icon-button" aria-label="添加 MCP 服务" title="添加 MCP 服务" @click="addMCP"><AppIcon name="plus" :size="15" /></button>
      </header>
      <div class="mcp-list__items">
        <button v-for="item in props.mcp" :key="item.id" type="button" class="mcp-item" :class="{ 'is-selected': item.id === selectedID }" @click="selectedID = item.id">
          <span class="mcp-item__name">{{ item.name }}</span>
          <span class="mcp-item__command">{{ item.command || '未配置命令' }}</span>
          <span class="mcp-item__state" :class="{ 'is-enabled': item.enabled }">{{ item.enabled ? '启用' : '停用' }}</span>
        </button>
        <p v-if="!props.mcp.length" class="mcp-list__empty">还没有 MCP 服务</p>
      </div>
    </aside>

    <form v-if="selectedItem" class="mcp-form" @submit.prevent>
      <div class="mcp-form__top">
        <label class="mcp-field">
          <span>服务名称</span>
          <input class="field" :value="selectedItem.name" @input="updateField('name', $event.currentTarget.value)" />
        </label>
        <label class="mcp-enabled">
          <span>{{ selectedItem.enabled ? '已启用' : '已停用' }}</span>
          <input class="switch" type="checkbox" role="switch" :aria-label="`启用 ${selectedItem.name}`" :checked="selectedItem.enabled" @change="toggleEnabled" />
        </label>
      </div>

      <label class="mcp-field">
        <span>传输方式</span>
        <select class="field" :value="selectedItem.definition?.transport || 'stdio'" @change="updateDefinition('transport', $event.currentTarget.value)">
          <option value="stdio">stdio（标准输入输出）</option>
          <option value="sse">SSE（HTTP 流）</option>
          <option value="http">HTTP（流）</option>
        </select>
      </label>

      <label class="mcp-field">
        <span>{{ remote ? '服务地址（URL）' : '启动命令' }}</span>
        <input class="field" :value="selectedItem.command" :placeholder="remote ? 'http://localhost:3000/sse' : 'npx @modelcontextprotocol/server-xxx'" @input="updateField('command', $event.currentTarget.value)" />
      </label>

      <label v-if="!remote" class="mcp-field">
        <span>启动参数（每行一个）</span>
        <textarea class="field mcp-textarea" :value="(selectedItem.definition?.args || []).join('\n')" rows="3" placeholder="--port&#10;3000" @input="updateDefinition('args', $event.currentTarget.value.split('\n').filter(Boolean))"></textarea>
      </label>

      <label v-if="!remote" class="mcp-field">
        <span>环境变量（JSON 格式）</span>
        <textarea class="field mcp-textarea" :value="JSON.stringify(selectedItem.definition?.env || {}, null, 2)" rows="4" placeholder='{"API_KEY": "xxx"}' @input="tryUpdateEnv($event.currentTarget.value)"></textarea>
      </label>

      <footer class="mcp-actions">
        <button type="button" class="button button--danger" @click="requestRemove"><AppIcon name="trash" :size="14" />删除此服务</button>
      </footer>
    </form>

    <p v-else class="mcp-empty">添加一个 MCP 服务以开始配置</p>

    <dialog ref="deleteDialog" class="dialog" aria-label="删除 MCP 服务确认">
      <h2>删除 MCP 服务？</h2>
      <p>此 MCP 服务的未保存配置将被移除。</p>
      <div class="dialog-actions">
        <button type="button" class="button" @click="deleteDialog.close()">取消</button>
        <button type="button" class="button button--danger" @click="removeMCP">删除</button>
      </div>
    </dialog>
  </section>
</template>

<style scoped lang="scss">
.mcp-settings { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 24px; min-height: 0; }
.mcp-list { display: flex; min-height: 0; flex-direction: column; padding: 12px; border-radius: 8px; background: var(--la-layer-01); box-shadow: inset 0 0 0 .5px var(--la-line); }
.mcp-list__head { display: flex; height: 28px; flex: none; align-items: center; justify-content: space-between; padding: 0 2px; color: var(--la-muted); font-size: 13px; font-weight: 530; }
.mcp-list__items { display: flex; min-height: 0; flex-direction: column; gap: 2px; overflow-y: auto; }
.mcp-item { display: flex; min-height: 40px; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; padding: 4px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--la-secondary); text-align: left; cursor: pointer; }
.mcp-item:hover { background: var(--la-hover); }
.mcp-item.is-selected { background: var(--la-layer-03); color: var(--la-text); }
.mcp-item__name { max-width: 100%; overflow: hidden; color: var(--la-text); font-size: 13px; font-weight: 530; text-overflow: ellipsis; white-space: nowrap; }
.mcp-item__command { max-width: 100%; overflow: hidden; color: var(--la-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.mcp-item__state { display: none; }
.mcp-list__empty { margin: 8px 4px; color: var(--la-muted); font-size: 12px; }
.mcp-form { display: flex; min-width: 0; flex-direction: column; gap: 16px; }
.mcp-form__top { display: flex; align-items: end; gap: 16px; }
.mcp-form__top .mcp-field { flex: 1; }
.mcp-field { display: flex; min-width: 0; flex-direction: column; gap: 6px; color: var(--la-muted); font-size: 13px; font-weight: 440; }
.mcp-field .field { height: 36px; }
.mcp-textarea { height: auto; min-height: 88px; padding: 8px 10px; resize: vertical; line-height: 20px; }
.mcp-enabled { display: flex; height: 36px; flex: none; align-items: center; gap: 8px; color: var(--la-muted); font-size: 13px; }
.mcp-actions { padding-top: 12px; border-top: .5px solid var(--la-line); }
.mcp-empty { align-self: center; justify-self: center; color: var(--la-muted); font-size: 13px; }
@media (max-width: 767px) {
  .mcp-settings { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .mcp-list { max-height: 180px; }
  .mcp-form__top { flex-wrap: wrap; }
  .mcp-form__top .mcp-field { flex-basis: 100%; }
}
</style>
