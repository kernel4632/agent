<!--
会话标题编辑器：点击标题进入无感输入态，回车保存，Escape 放弃。
输入态不提供额外勾叉按钮，避免把一个短编辑动作变成显式表单流程。
调用示例：<SessionTitleEditor :title="title" @save="rename" />。
-->
<script setup>
import { nextTick, ref } from 'vue'                    // 引入输入聚焦和本地草稿状态
import { Session } from '../commands/session.js'      // 引入标题草稿和编辑状态指令

const props = defineProps({                           // 声明当前标题和保存状态
  title: { type: String, default: '' },               // 非编辑态展示的会话标题
  busy: { type: Boolean, default: false },            // 保存中避免重复请求
  compact: { type: Boolean, default: false },         // 顶栏使用紧凑宽度
})

const emit = defineEmits(['save'])                    // 将标题保存意图交回业务视图
const editing = ref(false)                            // 控制标题文本和输入框切换
const draft = ref('')                                 // 保存尚未提交的标题草稿
const inputElement = ref(null)                        // 保存原位输入元素引用


// --- 开始编辑标题 ---
async function startEditing() {
  if (!Session.startTitleEditing(props.title, props.busy, editing, draft)) return // 指令创建标题草稿并切换编辑态
  await nextTick()                                   // 等待输入元素挂载
  inputElement.value?.select()                       // 全选后直接输入新标题
}


// --- 放弃标题编辑 ---
function cancelEditing() {
  Session.cancelTitleEditing(props.busy, editing)     // 指令丢弃草稿并恢复原文本
}


// --- 保存标题编辑 ---
async function saveEditing() {
  await Session.saveTitleEditing(props.title, draft, editing, emit) // 指令校验草稿并等待 Server 保存反馈
}


// --- 修改标题输入草稿 ---
function updateDraft(event) {
  Session.setTitleDraft(draft, event.target.value)     // 将输入值交给会话指令修改草稿
}
</script>

<template>
  <span class="session-title-editor" :class="{ 'session-title-editor--compact': compact, 'is-editing': editing }" @click.stop>
    <input v-if="editing" ref="inputElement" :value="draft" maxlength="100" :disabled="busy" aria-label="会话标题" @input="updateDraft" @keydown.enter.prevent="saveEditing" @keydown.esc.prevent="cancelEditing" @blur="saveEditing" />
    <button v-else type="button" :title="title || '未命名会话'" aria-label="重命名会话" @click="startEditing">{{ title || '未命名会话' }}</button>
  </span>
</template>
