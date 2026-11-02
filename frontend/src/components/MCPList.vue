<!--
MCP 服务页：默认是服务列表；点一行进入该服务的编辑页。
列表和编辑页共用 draft.mcp，保存仍由设置页自动完成。
调用示例：<MCPList :draft="draft" :detail="detail" @open-detail="..." @close-detail="..." @update-detail-title="..." />
-->
<script setup>
import { computed } from 'vue'
import { Icon, Button } from '../ui/index.js'
import MCPEditor from './MCPEditor.vue'

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
  <section v-if="!detail" class="mcp-list" aria-label="MCP 服务">
    <header class="mcp-list__head">
      <p>连接外部工具服务，让模型可以调用浏览器、数据库或其他本地能力。</p>
      <Button @click="addMCP()"><Icon name="plus" :size="18" />添加服务</Button>
    </header>

    <div v-if="draft.mcp.length" class="mcp-list__card">
      <Button
        v-for="item in draft.mcp"
        :key="item.id"
        variant="plain"
        class="mcp-row"
        @click="emit('open-detail', { id: item.id, title: item.name })"
      >
        <span class="mcp-row__icon" aria-hidden="true"><Icon name="link" :size="20" /></span>
        <span class="mcp-row__copy">
          <strong>{{ item.name }}</strong>
          <small>{{ item.command || '未配置命令或地址' }}</small>
        </span>
        <span class="mcp-row__state" :class="{ 'is-on': item.enabled }">{{ item.enabled ? '已启用' : '已停用' }}</span>
        <Icon name="arrow" :size="16" class="mcp-row__arrow" aria-hidden="true" />
      </Button>
    </div>

    <p v-else class="mcp-list__empty">还没有 MCP 服务。先添加一个外部工具服务。</p>
  </section>

  <div v-else-if="selected" :key="selected.id" class="mcp-detail">
    <MCPEditor :item="selected" @update="updateMCP" @delete="removeMCP" />
  </div>

  <div v-else class="mcp-missing">
    <p>这个 MCP 服务已经不存在了。</p>
    <Button @click="emit('close-detail')">返回服务列表</Button>
  </div>
</template>

<style scoped lang="scss" src="../styles/components/MCPList.scss"></style>
