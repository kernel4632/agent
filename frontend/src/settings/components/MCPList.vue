<!--
MCP 服务列表：一层页面只负责选择服务，点一行进入服务编辑页。
添加服务也在这一层完成；新增后直接打开编辑页。
调用示例：<MCPList :mcp="mcp" @select="openMCP" @add="addMCP" />
-->
<script setup>
import { AppIcon, Button } from '../../ui/index.js'

defineProps({ mcp: { type: Array, required: true } })
defineEmits(['select', 'add'])
</script>

<template>
  <section class="mcp-list" aria-label="MCP 服务">
    <header class="mcp-list__head">
      <p>连接外部工具服务，让模型可以调用浏览器、数据库或其他本地能力。</p>
      <Button @click="$emit('add')"><AppIcon name="plus" :size="18" />添加服务</Button>
    </header>

    <div v-if="mcp.length" class="mcp-list__card">
      <Button
        v-for="item in mcp"
        :key="item.id"
        variant="plain"
        class="mcp-row"
        @click="$emit('select', item)"
      >
        <span class="mcp-row__icon" aria-hidden="true"><AppIcon name="link" :size="20" /></span>
        <span class="mcp-row__copy">
          <strong>{{ item.name }}</strong>
          <small>{{ item.command || '未配置命令或地址' }}</small>
        </span>
        <span class="mcp-row__state" :class="{ 'is-on': item.enabled }">{{ item.enabled ? '已启用' : '已停用' }}</span>
        <AppIcon name="arrow" :size="16" class="mcp-row__arrow" aria-hidden="true" />
      </Button>
    </div>

    <p v-else class="mcp-list__empty">还没有 MCP 服务。先添加一个外部工具服务。</p>
  </section>
</template>

<style scoped lang="scss" src="../../styles/settings/components/MCPList.scss"></style>
