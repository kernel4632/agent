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
    <span v-for="file in files" :key="file.id"><AppIcon name="document" :size="16" />{{ file.name }}<IconButton size="small" :label="`移除附件 ${file.name}`" @click="emit('remove', file.id)"><AppIcon name="close" :size="15" /></IconButton></span>
  </div>
</template>

<style scoped lang="scss">
.chat-composer__files { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.chat-composer__files > span { display: flex; align-items: center; gap: 8px; max-width: 100%; min-height: 40px; padding-left: 12px; border-radius: 12px; background: var(--la-layer-02); color: var(--la-secondary); font-size: 13px; overflow-wrap: anywhere; }
</style>
