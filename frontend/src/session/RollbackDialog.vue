<!--
  回退确认：展示回退范围、受影响文件和“是否同时恢复文件”。
  用 ui/Dialog 作为唯一弹窗原语；父组件只负责取预览和执行回退。
-->
<script setup>
import { computed, ref } from 'vue'
import { KimaCheckbox } from '@kernel4632/kima'
import { Button, Dialog } from '../ui/index.js'

const props = defineProps({
  target: { type: Object, default: null },
  preview: { type: Object, default: null },
})
const emit = defineEmits(['confirm'])

const open = ref(false)
const restoreFiles = ref(true)
const question = computed(() => props.target?.role === 'assistant' ? '回到这条回复之前？' : '回到这条消息之前？')
const summary = computed(() => {
  if (!props.preview) return '此消息及之后的内容将从对话中回退。'
  return `从这条消息开始的 ${props.preview.messages} 条对话会被去掉，你可以在发送新消息前撤销这次回退。`
})

function show() {
  restoreFiles.value = true
  open.value = true
}

function close() {
  open.value = false
}

function confirm() {
  emit('confirm', restoreFiles.value)
}

defineExpose({ show, close })
</script>

<template>
  <Dialog :open="open" :label="question" @update:open="open = $event">
    <p>{{ summary }}</p>
    <label v-if="preview?.files?.length" class="rollback-files">
      <span>这一段的改动（{{ preview.files.length }} 个文件）</span>
      <ul><li v-for="file in preview.files" :key="file.path">{{ file.path }}</li></ul>
    </label>
    <KimaCheckbox v-model="restoreFiles" label="同时把文件改回原样" />
    <p class="rollback-hint">{{ restoreFiles ? '文件和对话一起退回这一步之前。' : '只退对话，工作区里的文件保持现在的样子。' }}</p>
    <div class="dialog-actions">
      <Button @click="close">取消</Button>
      <Button variant="primary" @click="confirm">确认回退</Button>
    </div>
  </Dialog>
</template>

<style scoped lang="scss">
.rollback-files { display: grid; gap: 10px; margin: 0 0 20px; }
.rollback-files > span { color: var(--la-muted); font-size: 13px; line-height: 20px; }
.rollback-files ul { max-height: 180px; margin: 0; padding: 12px 16px; overflow: auto; list-style: none; border-radius: 12px; background: var(--la-layer-02); }
.rollback-files li { color: var(--la-secondary); font: 13px/1.9 var(--la-font-mono); overflow-wrap: anywhere; }
.rollback-hint { margin: 12px 0 0 !important; color: var(--la-muted) !important; font-size: 13px !important; line-height: 20px !important; }
</style>
