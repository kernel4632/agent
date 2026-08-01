<!--
添加 Workspace 弹窗：保存名称和路径草稿，并向主页提交一次新增意图。
组件不执行 Command，成功与否由主页通过 resolve 回传。
调用示例：<WorkspaceDialog :open="open" @add="addWorkspace" />。
-->
<script setup>
import { ref } from 'vue'                                              // 保存弹窗内尚未提交的字段草稿
import { t } from '../../i18n.js'                                      // 提供弹窗与字段文案
import TextField from '../shared/TextField.vue'                       // 使用 M3E 标准输入字段

defineProps({ open: { type: Boolean, default: false } })              // 由主页控制弹窗可见状态
const emit = defineEmits(['add', 'close'])                             // 反馈新增和关闭意图
const name = ref('')                                                   // 尚未提交的 Workspace 名称
const path = ref('')                                                   // 尚未提交的 Workspace 路径


// --- 请求新增 Workspace ---
function submit() {
  emit('add', name.value, path.value, (saved) => {                     // Command 结果决定是否重置草稿
    if (!saved) return
    name.value = ''
    path.value = ''
  })
}
</script>

<template>
  <m3e-dialog class="workspace-dialog" :open="open" @closed="emit('close')">
    <span slot="header">{{ t('addWorkspace') }}</span>
    <span>{{ t('workspaceDescription') }}</span>
    <div class="dialog-fields">
      <TextField v-model="name" :label="t('name')" :placeholder="t('workspaceNameExample')" />
      <TextField v-model="path" :label="t('path')" :placeholder="t('workspacePathExample')" @keydown.enter="submit" />
    </div>
    <div slot="actions" end>
      <m3e-button><m3e-dialog-action @click="emit('close')">{{ t('cancel') }}</m3e-dialog-action></m3e-button>
      <m3e-button variant="filled" :disabled="!name.trim() || !path.trim()"><m3e-dialog-action @click="submit">{{ t('add') }}</m3e-dialog-action></m3e-button>
    </div>
  </m3e-dialog>
</template>
