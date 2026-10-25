<!--
  斜杠命令菜单：只负责显示匹配项和把选中项交给 Composer。
-->
<script setup>
import { Button } from '../ui/index.js'

defineProps({
  matches: { type: Array, default: () => [] },
  active: { type: Number, default: 0 },
})
const emit = defineEmits(['choose'])
</script>

<template>
  <div class="chat-composer__slash" role="listbox" aria-label="斜杠命令">
    <Button v-for="(command, index) in matches" :key="command.name" variant="plain" class="chat-composer__slash-item" :class="{ 'is-active': index === active }" role="option" :aria-selected="index === active" @mousedown.prevent="emit('choose', command)">
      <span class="chat-composer__slash-name">/{{ command.name }}</span>
      <span class="chat-composer__slash-description">{{ command.description }}</span>
    </Button>
  </div>
</template>

<style scoped lang="scss">
.chat-composer__slash {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 20;
  display: grid;
  max-height: 320px;
  padding: 8px;
  overflow-y: auto;
  gap: 2px;
  border-radius: 14px;
  background: var(--la-layer-01);
  box-shadow: var(--la-shadow-floating);
}
.chat-composer__slash-item {
  display: flex;
  min-height: 44px;
  align-items: baseline;
  gap: 12px;
  padding: 10px 14px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--la-secondary);
  text-align: left;
  cursor: pointer;
}
.chat-composer__slash-item.is-active, .chat-composer__slash-item:hover { background: var(--la-hover); color: var(--la-text); }
.chat-composer__slash-name { flex: none; color: var(--la-accent); font: 13px/1.6 var(--la-font-mono); white-space: nowrap; }
.chat-composer__slash-description { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
</style>
