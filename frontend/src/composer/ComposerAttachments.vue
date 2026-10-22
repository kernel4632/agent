<!--
  输入区附件条：只显示已附加文件并上抛移除动作。
-->
<script setup>
import { AppIcon, IconButton } from '../ui/index.js'

defineProps({ files: { type: Array, default: () => [] } })
const emit = defineEmits(['remove'])
</script>

<template>
  <div v-if="files.length" class="chat-composer__files">
    <span v-for="file in files" :key="file.id"><AppIcon name="document" :size="14" />{{ file.name }}<IconButton :label="`移除附件 ${file.name}`" @click="emit('remove', file.id)"><AppIcon name="close" :size="13" /></IconButton></span>
  </div>
</template>

<style scoped lang="scss">
.chat-composer__files { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.chat-composer__files > span { display: flex; align-items: center; gap: 6px; max-width: 100%; padding-left: 8px; border-radius: 6px; background: var(--la-layer-02); color: var(--la-secondary); font-size: 12px; overflow-wrap: anywhere; }
</style>
