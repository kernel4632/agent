<!--
MCP 服务页：默认是服务列表；点一行进入该服务的编辑页。
列表和编辑页共用 draft.mcp，保存仍由设置页自动完成。
调用示例：<MCPSPage :draft="draft" :detail="detail" @open-detail="..." @close-detail="..." @update-detail-title="..." />
-->
<script setup>
import { computed } from 'vue'
import { Button } from '../../ui/index.js'
import MCPEditor from '../components/MCPEditor.vue'
import MCPList from '../components/MCPList.vue'

const props = defineProps({
  draft: { type: Object, required: true },
  detail: { type: Object, default: null },
})
const emit = defineEmits(['open-detail', 'close-detail', 'update-detail-title'])

const selected = computed(() => props.detail
  ? props.draft.mcp.find(item => item.id === props.detail.id) ?? null
  : null)

function addMCP() {
  let number = props.draft.mcp.length + 1
  while (props.draft.mcp.some(item => item.name === `MCP ${number}`)) number += 1
  const item = {
    id: crypto.randomUUID(),
    name: `MCP ${number}`,
    command: '',
    enabled: true,
    definition: { transport: 'stdio', args: [], env: {} },
  }
  props.draft.mcp.push(item)
  emit('open-detail', { id: item.id, title: item.name })
}

function updateMCP(updated) {
  const items = props.draft.mcp
  const index = items.findIndex(item => item.id === updated.id)
  if (index < 0) return
  items[index] = updated
  if (props.detail?.id === updated.id) emit('update-detail-title', updated.name)
}

function removeMCP() {
  const items = props.draft.mcp
  const index = items.findIndex(item => item.id === props.detail?.id)
  if (index >= 0) items.splice(index, 1)
  emit('close-detail')
}
</script>

<template>
  <MCPList
    v-if="!detail"
    :mcp="draft.mcp"
    @select="item => emit('open-detail', { id: item.id, title: item.name })"
    @add="addMCP"
  />

  <div v-else-if="selected" :key="selected.id" class="mcp-detail">
    <MCPEditor :item="selected" @update="updateMCP" @delete="removeMCP" />
  </div>

  <div v-else class="mcp-missing">
    <p>这个 MCP 服务已经不存在了。</p>
    <Button @click="emit('close-detail')">返回服务列表</Button>
  </div>
</template>

<style scoped lang="scss">
.mcp-detail { display: block; }
.mcp-missing { display: grid; justify-items: start; gap: 16px; padding: 24px; border-radius: 20px; background: var(--la-layer-01); }
.mcp-missing p { margin: 0; color: var(--la-muted); font-size: 14px; }
</style>
