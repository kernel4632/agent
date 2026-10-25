<!--
MCP 服务管理：展示已配置的 MCP 服务连接，支持编辑、删除和启用/禁用。
设计思想：左侧列表选择，右侧编辑面板修改详情，与供应商配置保持一致的交互模式。
核心数据：mcp（MCP 配置数组，每项含 id、name、command、enabled、definition）。
传输方式直接用 KimaSelect，其余控件走 ui/；args 按行拆分、env 按 JSON 解析和删除确认仍在本组件完成。
调用示例：<MCPSettings v-model:mcp="settingsDraft.mcp" />。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { KimaSelect } from '@kernel4632/kima'
import { AppIcon, Button, Dialog, Field, Switch } from '../../ui/index.js'

const props = defineProps({
  mcp: { type: Array, required: true },
})
const emit = defineEmits(['update:mcp'])

// 三种传输方式和保存到 definition.transport 的值一一对应。
const TRANSPORT_OPTIONS = [
  { value: 'stdio', label: 'stdio（标准输入输出）' },
  { value: 'sse', label: 'SSE（HTTP 流）' },
  { value: 'http', label: 'HTTP（流）' },
]

const selectedID = ref(props.mcp[0]?.id ?? '')
const selectedItem = computed(() => props.mcp.find(item => item.id === selectedID.value) ?? null)
const remote = computed(() => ['sse', 'http'].includes(selectedItem.value?.definition?.transport))
const deleteOpen = ref(false)

function requestRemove() {
  deleteOpen.value = true
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
  deleteOpen.value = false
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
    <header class="mcp-head">
      <p class="mcp-head__copy">连接外部工具服务，让模型可以调用浏览器、数据库或其他本地能力。</p>
      <Button @click="addMCP"><AppIcon name="plus" :size="18" />添加服务</Button>
    </header>

    <div class="mcp-body">
      <aside class="mcp-list">
        <div class="mcp-list__items">
          <Button
            v-for="item in props.mcp"
            :key="item.id"
            variant="plain"
            class="mcp-item"
            :class="{ 'is-selected': item.id === selectedID }"
            @click="selectedID = item.id"
          >
            <span class="mcp-item__name">{{ item.name }}</span>
            <span class="mcp-item__command">{{ item.command || '未配置命令' }}</span>
            <span class="mcp-item__state" :class="{ 'is-enabled': item.enabled }">{{ item.enabled ? '已启用' : '已停用' }}</span>
          </Button>
          <p v-if="!props.mcp.length" class="mcp-list__empty">还没有 MCP 服务</p>
        </div>
      </aside>

      <form v-if="selectedItem" class="mcp-form" @submit.prevent>
        <header class="mcp-form__head">
          <h3>{{ selectedItem.name }}</h3>
          <Switch :model-value="selectedItem.enabled" label="启用此服务" @update:model-value="toggleEnabled" />
        </header>

        <Field caption="服务名称" :model-value="selectedItem.name" @update:model-value="updateField('name', $event)" />

        <div class="mcp-field">
          <span class="mcp-field__caption">传输方式</span>
          <KimaSelect
            label="传输方式"
            :model-value="selectedItem.definition?.transport || 'stdio'"
            :items="TRANSPORT_OPTIONS"
            @update:model-value="updateDefinition('transport', $event)"
          />
        </div>

        <Field
          :caption="remote ? '服务地址（URL）' : '启动命令'"
          :model-value="selectedItem.command"
          :placeholder="remote ? 'http://localhost:3000/sse' : 'npx @modelcontextprotocol/server-xxx'"
          @update:model-value="updateField('command', $event)"
        />

        <Field
          v-if="!remote"
          caption="启动参数（每行一个）"
          multiline
          :rows="3"
          :model-value="(selectedItem.definition?.args || []).join('\n')"
          placeholder="--port&#10;3000"
          @update:model-value="updateDefinition('args', $event.split('\n').filter(Boolean))"
        />

        <Field
          v-if="!remote"
          caption="环境变量（JSON 格式）"
          multiline
          :rows="4"
          :model-value="JSON.stringify(selectedItem.definition?.env || {}, null, 2)"
          placeholder='{"API_KEY": "xxx"}'
          @update:model-value="tryUpdateEnv"
        />

        <footer class="mcp-actions">
          <Button variant="danger" @click="requestRemove"><AppIcon name="trash" :size="18" />删除此服务</Button>
        </footer>
      </form>

      <p v-else class="mcp-empty">添加一个 MCP 服务以开始配置</p>
    </div>

    <Dialog :open="deleteOpen" label="删除 MCP 服务" @update:open="deleteOpen = $event">
      <p>删除后会自动保存，这个 MCP 服务会从列表中移除。</p>
      <div class="dialog-actions">
        <Button @click="deleteOpen = false">取消</Button>
        <Button variant="danger" @click="removeMCP">删除</Button>
      </div>
    </Dialog>
  </section>
</template>

<style scoped lang="scss">
.mcp-settings { display: flex; min-height: 0; flex-direction: column; gap: 24px; }
.mcp-head { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.mcp-head__copy { max-width: 560px; margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
.mcp-body { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 24px; align-items: start; min-height: 0; }
.mcp-list { display: flex; min-height: 0; flex-direction: column; padding: 12px; border-radius: 20px; background: var(--la-layer-01); }
.mcp-list__items { display: flex; min-height: 0; flex-direction: column; gap: 4px; overflow-y: auto; }
.mcp-item {
  display: grid;
  min-height: 68px;
  align-content: center;
  gap: 2px;
  padding: 10px 14px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--la-secondary);
  text-align: left;
  cursor: pointer;
}
.mcp-item:hover { background: var(--la-hover); }
.mcp-item.is-selected { background: var(--la-layer-03); color: var(--la-text); }
.mcp-item__name { max-width: 100%; overflow: hidden; color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
.mcp-item__command { max-width: 100%; overflow: hidden; color: var(--la-muted); font-size: 13px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.mcp-item__state { color: var(--la-muted); font-size: 13px; line-height: 20px; }
.mcp-item__state.is-enabled { color: var(--la-success); }
.mcp-list__empty { margin: 16px 8px; color: var(--la-muted); font-size: 14px; }
.mcp-form {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  border-radius: 20px;
  background: var(--la-layer-01);
}
.mcp-form__head { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.mcp-form__head h3 { margin: 0; color: var(--la-text); font-size: 18px; font-weight: 600; line-height: 26px; }
/* KIMA Select 只画控件，不画可见标题；标题留给页面排版，避免和 aria-label 重复。 */
.mcp-field { display: grid; gap: 8px; }
.mcp-field__caption { color: var(--kima-color-on-surface-variant); font-size: 14px; font-weight: 500; line-height: 20px; }
.mcp-actions { padding-top: 20px; border-top: .5px solid var(--la-line); }
.mcp-empty { align-self: center; justify-self: center; color: var(--la-muted); font-size: 14px; }
@media (max-width: 767px) {
  .mcp-head { flex-direction: column; align-items: flex-start; }
  .mcp-body { grid-template-columns: minmax(0, 1fr); }
  .mcp-list { max-height: 260px; }
  .mcp-form { padding: 20px; }
  .mcp-form__head { flex-wrap: wrap; }
}
</style>
