<!--
  斜杠命令菜单：只负责显示匹配项和把选中项交给 Composer。
  调用示例：<ComposerSlashMenu :matches="matches" :active="active" @pick="applyCommand" />
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

<style scoped lang="scss" src="../styles/components/ComposerSlashMenu.scss"></style>
