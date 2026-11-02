<!--
输入区附件条：用 自有 Chip 显示已附加文件，并上抛移除动作。
调用示例：<ComposerAttachments :files="files" @remove="removeFile" />
-->
<script setup>
import { Chip } from '../ui/index.js'
import { AppIcon } from '../ui/index.js'

defineProps({ files: { type: Array, default: () => [] } })
const emit = defineEmits(['remove'])
</script>

<template>
  <Transition name="attachments">
    <div v-if="files.length" class="chat-composer__files">
      <Chip
        v-for="file in files"
        :key="file.id"
        class="chat-composer__file"
        closable
        :label="file.name"
        @close="emit('remove', file.id)"
      >
        <AppIcon name="document" :size="16" />{{ file.name }}
      </Chip>
    </div>
  </Transition>
</template>

<style scoped lang="scss" src="../styles/composer/ComposerAttachments.scss"></style>
