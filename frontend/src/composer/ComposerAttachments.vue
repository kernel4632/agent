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

<style scoped lang="scss">
.chat-composer__files { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.chat-composer__file { max-width: 100%; }
/* 长文件名只截一行，不能把输入框越撑越高；完整名字仍在移除按钮的无障碍名称里。 */
.chat-composer__file :deep(.kima-chip__text) {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachments-enter-active, .attachments-leave-active { transition: opacity var(--kima-duration-fast) var(--kima-curve-standard), transform var(--kima-duration-medium) var(--kima-curve-standard); }
.attachments-enter-from, .attachments-leave-to { opacity: 0; transform: translateY(6px); }
</style>
