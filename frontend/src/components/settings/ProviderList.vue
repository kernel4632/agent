<script setup>
defineProps({ providers: { type: Array, required: true }, selectedId: String })
defineEmits(['select'])
</script>

<template>
  <nav class="provider-list" aria-label="供应商列表">
    <button v-for="provider in providers" :key="provider.id" :class="{ selected: provider.id === selectedId }" :aria-pressed="provider.id === selectedId" @click="$emit('select', provider.id)">{{ provider.name }}<span v-if="!provider.enabled">停用</span></button>
  </nav>
</template>

<style scoped lang="scss">
.provider-list {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px;
  button { max-width: 100%; padding: 8px 12px; border: 1px solid var(--la-line); border-radius: 6px; background: transparent; color: var(--la-secondary); font-size: 12px; cursor: pointer; overflow-wrap: anywhere; }
  button.selected { background: var(--la-setting-row); color: var(--la-text); }
  span { margin-left: 6px; color: var(--la-muted); font-size: 10px; }
}
</style>
