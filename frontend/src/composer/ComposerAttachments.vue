<!--
输入区附件条：用 KIMA Chip 显示已附加文件，并上抛移除动作。
-->
<script setup>
import { KimaChip } from '@kernel4632/kima'
import { AppIcon } from '../ui/index.js'

defineProps({ files: { type: Array, default: () => [] } })
const emit = defineEmits(['remove'])
</script>

<template>
  <div v-if="files.length" class="chat-composer__files">
    <KimaChip
      v-for="file in files"
      :key="file.id"
      class="chat-composer__file"
      removable
      :label="file.name"
      remove-label="移除附件"
      @remove="emit('remove', file.id)"
    >
      <AppIcon name="document" :size="16" />{{ file.name }}
    </KimaChip>
  </div>
</template>

<style scoped lang="scss">
.chat-composer__files { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.chat-composer__file { max-width: 100%; }
</style>
