<!--
供应商列表：展示所有供应商名称和启用状态，选中项高亮，点击发出 select。
列表项用 Button 的 plain 变体，尺寸和选中背景仍由本组件的 .provider-list 样式负责。
调用示例：<ProviderList :providers="providers" :selected-id="selectedId" @select="selectProvider" />
-->
<script setup>
import { Button } from '../../ui/index.js'

defineProps({ providers: { type: Array, required: true }, selectedId: String })
defineEmits(['select'])
</script>

<template>
  <nav class="provider-list" aria-label="供应商列表">
    <Button
      v-for="provider in providers"
      :key="provider.id"
      variant="plain"
      :class="{ selected: provider.id === selectedId }"
      :aria-pressed="provider.id === selectedId"
      @click="$emit('select', provider.id)"
    >{{ provider.name }}<span v-if="!provider.enabled">停用</span></Button>
  </nav>
</template>

<style scoped lang="scss">
.provider-list {
  display: flex; flex-wrap: wrap; gap: 6px; margin: 0;
  button { max-width: 100%; height: 28px; padding: 0 10px; border: 0; border-radius: 4px; background: var(--la-layer-01); color: var(--la-secondary); font-size: 13px; font-weight: 440; cursor: pointer; overflow-wrap: anywhere; }
  button:hover { color: var(--la-text); }
  button.selected { background: var(--la-layer-03); color: var(--la-text); }
  span { margin-left: 6px; color: var(--la-muted); font-size: 11px; }
}
</style>
