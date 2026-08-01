<!-- MCP 设置：展示服务状态并发出新增、修改和删除意图。 -->
<script setup>
import { t } from '../../i18n.js'                                      // 提供 MCP 配置文案
import TextField from '../shared/TextField.vue'                       // 使用 M3E 服务字段
defineProps({ servers: { type: Array, default: () => [] } })
defineEmits(['add', 'update', 'remove'])                               // 将 MCP 动作交回设置页 Command
</script>

<template>
  <section class="simple-settings">
    <header class="simple-settings__heading"><div><h3>{{ t('mcpServices') }}</h3><p>{{ t('mcpDescription') }}</p></div><m3e-button @click="$emit('add')"><m3e-icon slot="icon" name="add"></m3e-icon>{{ t('addMcp') }}</m3e-button></header>
    <m3e-card v-for="server in servers" :key="server.id" class="mcp-setting">
      <div class="mcp-setting__layout">
        <span class="mcp-setting__status" :class="`is-${server.status}`"></span>
        <TextField :model-value="server.name" :label="t('mcpName')" @update:model-value="$emit('update', server.id, { name: $event })" />
        <TextField :model-value="server.command" :label="t('launchCommand')" @update:model-value="$emit('update', server.id, { command: $event })" />
        <small>{{ t('toolCount', { count: server.toolCount }) }}</small>
        <m3e-switch :checked="server.enabled" @change="$emit('update', server.id, { enabled: $event.target.checked })"></m3e-switch>
        <m3e-icon-button class="icon-command" :aria-label="t('deleteMcp')" :title="t('deleteMcp')" @click="$emit('remove', server.id)"><m3e-icon name="delete"></m3e-icon></m3e-icon-button>
      </div>
    </m3e-card>
    <div v-if="!servers.length" class="empty-state">{{ t('noMcp') }}</div>
  </section>
</template>
