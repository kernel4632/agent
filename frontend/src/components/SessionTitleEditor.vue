<!--
会话标题编辑器：在原位置切换文本和输入框，并统一处理保存、取消与键盘行为。
组件只发出保存意图；Server 修改和多个数据源同步由使用它的业务视图完成。
调用示例：<SessionTitleEditor :title="title" @save="rename" />。
-->
<script setup>
import { nextTick, ref } from 'vue'                    // 引入本地编辑状态和自动聚焦能力

const props = defineProps({                           // 声明当前标题和请求状态
  title: { type: String, default: '' },               // 非编辑状态展示的真实标题
  busy: { type: Boolean, default: false },            // 保存中禁止重复提交
  compact: { type: Boolean, default: false },         // 顶栏使用更紧凑宽度
})

const emit = defineEmits(['save'])                    // 将清理后的标题交给业务视图
const editing = ref(false)                            // 控制原位文本和输入框切换
const draft = ref('')                                 // 保存尚未提交的标题副本
const inputElement = ref(null)                        // 保存自动全选所需输入元素


// --- 开始编辑标题 ---
async function startEditing() {
  if (props.busy) return                              // 请求进行中不创建第二份草稿
  draft.value = props.title || '未命名会话'           // 从当前可见标题建立编辑副本
  editing.value = true                               // 原位切换为文本输入
  await nextTick()                                   // 等待输入框进入真实 DOM
  inputElement.value?.select()                       // 全选便于直接输入新名称
}


// --- 取消标题编辑 ---
function cancelEditing() {
  if (props.busy) return                              // 保存期间保持稳定反馈
  editing.value = false                              // 丢弃本地草稿并恢复原标题
}


// --- 保存标题编辑 ---
async function saveEditing() {
  const title = draft.value.trim()                   // 客户端先移除无意义首尾空白
  if (!title || title === props.title) return cancelEditing() // 空值或无变化不发网络请求
  const saved = await new Promise((resolve) => emit('save', title, resolve)) // 等待业务层同步 Server 和所有标题来源
  if (saved) editing.value = false                   // 仅成功后退出，失败保留输入供修正
}
</script>

<template>
  <span class="session-title-editor" :class="{ 'session-title-editor--compact': compact, 'is-editing': editing }" @click.stop>
    <input v-if="editing" ref="inputElement" v-model="draft" maxlength="100" :disabled="busy" aria-label="会话标题" @keydown.enter.prevent="saveEditing" @keydown.esc.prevent="cancelEditing" />
    <button v-else type="button" :title="title || '未命名会话'" aria-label="重命名会话" @click="startEditing">{{ title || '未命名会话' }}</button>
    <span v-if="editing" class="session-title-editor__actions">
      <mdui-button-icon aria-label="取消重命名" :disabled="busy" @click="cancelEditing"><mdui-icon-close></mdui-icon-close></mdui-button-icon>
      <mdui-button-icon aria-label="保存会话标题" :disabled="busy || !draft.trim()" @click="saveEditing"><mdui-icon-check></mdui-icon-check></mdui-button-icon>
    </span>
  </span>
</template>
