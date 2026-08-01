<!--
会话标题编辑器：双击标题进入无感输入态，回车或失焦保存，Escape 放弃。
输入态不提供额外勾叉按钮，避免把一个短编辑动作变成显式表单流程。
调用示例：<SessionTitleEditor :title="title" @save="rename" />。
-->
<script setup>
import { nextTick, ref } from 'vue'                    // 引入输入聚焦和本地草稿状态
import { Session } from '../../commands/session.js'   // 引入标题草稿和编辑状态指令
import { t } from '../../i18n.js'                     // 引入响应式界面翻译
import TextField from '../shared/TextField.vue'       // 引入 M3E 标准文本字段

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
  if (props.busy) return                             // 保存期间不创建第二份标题草稿
  draft.value = props.title || t('unnamedSession')    // 以当前标题作为可编辑初值
  editing.value = true                              // 原位切换到输入状态
  await nextTick()                                   // 等待输入元素挂载
  inputElement.value?.select()                       // 全选后直接输入新标题
}


// --- 放弃标题编辑 ---
function cancelEditing() {
  if (!props.busy) editing.value = false              // 保存期间忽略失焦和取消事件
}


// --- 保存标题编辑 ---
async function saveEditing() {
  await Session.saveTitleEditing(props.title, draft, editing, emit) // 指令校验草稿并等待 Server 保存反馈
}


</script>

<template>
  <span class="session-title-editor" :class="{ 'session-title-editor--compact': compact, 'is-editing': editing }" @click.stop>
    <TextField v-if="editing" ref="inputElement" v-model="draft" maxlength="100" :disabled="busy" :label="t('sessionTitle')" @keydown.enter.prevent="saveEditing" @keydown.esc.prevent="cancelEditing" @blur="saveEditing" />
    <m3e-button v-else :title="title || t('unnamedSession')" :aria-label="t('doubleClickRenameSession')" @dblclick="startEditing">{{ title || t('unnamedSession') }}</m3e-button>
  </span>
</template>

<style lang="scss" src="../../styles/components/SessionTitleEditor.scss"></style>
