<!--
对话操作框：组合附件、输入、Session 模型选择和发送/暂停动作。
组件只发出用户意图；附件、模型和消息都由 Chat 或 Session 指令修改。
调用示例：<InputBox :session="session" :models="models" @send="send" />。
-->
<script setup>
import { nextTick, ref } from 'vue'                                  // 引入文件选择和发送后聚焦
import { Chat } from '../commands/chat.js'                           // 引入输入校验动作
import { t } from '../i18n.js'                                       // 引入响应式界面翻译

const props = defineProps({
  session: { type: Object, required: true },                         // 当前完整 Session
  models: { type: Array, default: () => [] },                        // 全局启用模型目录
})
const emit = defineEmits(['send', 'stop', 'select-model', 'attach', 'remove-file']) // 向对话页反馈全部用户动作
const content = defineModel({ type: String, default: '' })           // 当前 Session 输入草稿
const inputElement = ref(null)                                       // 发送后恢复键盘焦点
const fileInput = ref(null)                                          // 隐藏原生文件选择器


// --- 提交当前消息 ---
async function submit() {
  if (!Chat.submitInput(content, props.session.status === 'running', emit)) return // 指令拒绝空文本和重复发送
  await nextTick()                                                    // 等待输入框清空
  inputElement.value?.focus()                                        // 保持连续对话效率
}


// --- 处理键盘发送 ---
function handleKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) return                 // Shift+Enter 和其他按键保留输入行为
  event.preventDefault()                                              // Enter 不插入换行
  submit()                                                            // 触发与发送按钮一致的动作
}


// --- 处理附件选择 ---
function selectFiles(event) {
  const files = [...event.target.files]                               // 将浏览器 FileList 转为普通数组
  if (files.length) emit('attach', files)                             // 只提交真实选择结果
  event.target.value = ''                                             // 允许稍后重复选择同一文件
}
</script>

<template>
  <div class="composer">
    <div v-if="session.files.length" class="composer__files">
      <mdui-chip v-for="file in session.files" :key="file.id" deletable :aria-label="t('removeFile', { name: file.name })" @delete="emit('remove-file', file.id)"><mdui-icon-attach-file slot="icon"></mdui-icon-attach-file>{{ file.name }}</mdui-chip>
    </div>
    <mdui-text-field ref="inputElement" class="composer__input" variant="filled" autosize :min-rows="1" :max-rows="8" :value="content" :placeholder="t('messagePlaceholder')" :aria-label="t('message')" @input="content = $event.target.value" @keydown="handleKeydown"></mdui-text-field>
    <div class="composer__bar">
      <div class="composer__left">
        <input ref="fileInput" class="visually-hidden" type="file" multiple @change="selectFiles" />
        <mdui-button-icon class="icon-command" :aria-label="t('uploadFile')" :title="t('uploadFile')" @click="fileInput.click()"><mdui-icon-attach-file></mdui-icon-attach-file></mdui-button-icon>
        <mdui-select class="model-select" variant="filled" :value="`${session.provider}/${session.model}`" :disabled="session.status === 'running'" :aria-label="t('switchModel')" @change="emit('select-model', $event.target.value)"><mdui-menu-item v-for="item in models" :key="`${item.provider}/${item.model}`" :value="`${item.provider}/${item.model}`">{{ item.model }} · {{ item.provider }}</mdui-menu-item></mdui-select>
      </div>
      <mdui-button-icon v-if="session.status === 'running'" class="send-command is-stop" variant="filled" :aria-label="t('pauseGeneration')" :title="t('pauseGeneration')" @click="emit('stop')"><mdui-icon-stop></mdui-icon-stop></mdui-button-icon>
      <mdui-button-icon v-else class="send-command" variant="filled" :disabled="!content.trim()" :aria-label="t('send')" :title="t('send')" @click="submit"><mdui-icon-arrow-upward></mdui-icon-arrow-upward></mdui-button-icon>
    </div>
  </div>
</template>

<style lang="scss" src="../styles/components/InputBox.scss"></style>
