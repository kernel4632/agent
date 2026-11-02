<!--
  回退确认：展示回退范围、受影响文件和“是否同时恢复文件”。
  用 ui/Dialog 作为唯一弹窗原语；父组件只负责取预览和执行回退。
  调用示例：<RollbackDialog :open="open" :preview="preview" @confirm="rollback" @close="open = false" />
-->
<script setup>
import { computed, ref } from 'vue'
import { Checkbox } from '../ui/index.js'
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
    <Checkbox v-model="restoreFiles" label="同时把文件改回原样" />
    <p class="rollback-hint">{{ restoreFiles ? '文件和对话一起退回这一步之前。' : '只退对话，工作区里的文件保持现在的样子。' }}</p>
    <div class="dialog-actions">
      <Button @click="close">取消</Button>
      <Button variant="primary" @click="confirm">确认回退</Button>
    </div>
  </Dialog>
</template>

<style scoped lang="scss" src="../styles/components/RollbackDialog.scss"></style>
