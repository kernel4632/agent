<!--
工具管理页包装：默认是工具列表，点一行进入该工具的权限页。
不读取 store，也不负责保存；权限变化通过 v-model:tools 写回 draft.tools。
调用示例：<ToolsPage :draft="draft" :detail="detail" @open-detail="..." @close-detail="..." @update-detail-title="..." />
-->
<script setup>
import ToolsSettings from '../components/ToolsSettings.vue'

defineProps({
  draft: { type: Object, required: true },
  detail: { type: Object, default: null },
})
const emit = defineEmits(['open-detail', 'close-detail', 'update-detail-title'])
</script>

<template>
  <ToolsSettings
    v-model:tools="draft.tools"
    :detail="detail"
    @open-detail="emit('open-detail', $event)"
    @close-detail="emit('close-detail')"
    @update-detail-title="emit('update-detail-title', $event)"
  />
</template>
