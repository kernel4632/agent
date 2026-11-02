<!--
输入区附件条：用 KIMA Chip 显示已附加文件，并上抛移除动作。
调用示例：<ComposerAttachments :files="files" @remove="removeFile" />
-->
<script setup>
import { KimaChip } from '../ui/index.js'
import { AppIcon } from '../ui/index.js'

defineProps({ files: { type: Array, default: () => [] } })
const emit = defineEmits(['remove'])
</script>

<template>
  <Transition name="attachments">
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
  </Transition>
</template>

<style scoped lang="scss" src="../styles/composer/ComposerAttachments.scss"></style>
