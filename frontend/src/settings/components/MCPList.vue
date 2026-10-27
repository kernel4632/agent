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

<style scoped lang="scss">
.mcp-list { display: flex; flex-direction: column; gap: 16px; }
.mcp-list__head { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.mcp-list__head p { margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
.mcp-list__card {
  overflow: hidden;
  border-radius: 24px;
  background: var(--la-layer-01);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
}
.mcp-row {
  display: flex;
  width: 100%;
  min-height: 84px;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--la-text);
  text-align: left;
  cursor: pointer;
}
.mcp-row + .mcp-row { border-top: .5px solid var(--la-line); }
.mcp-row:hover { background: var(--la-hover); }
.mcp-row:focus-visible { position: relative; z-index: 1; outline-offset: -2px; }
.mcp-row__icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--la-success) 16%, transparent);
  color: var(--la-success);
}
.mcp-row__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.mcp-row__copy strong { overflow: hidden; color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
.mcp-row__copy small { overflow: hidden; color: var(--la-muted); font-size: 13px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.mcp-row__state { flex: none; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.mcp-row__state.is-on { color: var(--la-success); }
.mcp-row__arrow { flex: none; color: var(--la-muted); }
.mcp-list__empty { margin: 0; padding: 40px 20px; border-radius: 24px; background: var(--la-layer-01); color: var(--la-muted); text-align: center; font-size: 14px; }
@media (max-width: 767px) {
  .mcp-list__head { align-items: flex-start; flex-direction: column; gap: 12px; }
  .mcp-row { min-height: 80px; padding: 12px 16px; }
  .mcp-row__state { display: none; }
}
</style>
