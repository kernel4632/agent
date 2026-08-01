<!--
对话操作框：组合附件、输入、Session 模型选择和发送/暂停动作。
组件只发出用户意图；附件、模型和消息都由 Chat 或 Session 指令修改。
调用示例：<InputBox :session="session" :models="models" @send="send" />。
-->
<script setup>
import { computed, nextTick, ref } from 'vue'                        // 引入模型目录、文件选择和发送后聚焦
import { Chat } from '../../commands/chat.js'                        // 引入输入校验动作
import { t } from '../../i18n.js'                                    // 引入响应式界面翻译
import SelectField from '../shared/SelectField.vue'                  // 引入 M3E 模型选择字段
import TextAreaField from '../shared/TextAreaField.vue'              // 引入 M3E 自适应消息字段

const props = defineProps({
  session: { type: Object, required: true },                         // 当前完整 Session
  models: { type: Array, default: () => [] },                        // 全局启用模型目录
})
const emit = defineEmits(['send', 'stop', 'select-model', 'attach', 'remove-file']) // 向对话页反馈全部用户动作
const content = defineModel({ type: String, default: '' })           // 当前 Session 输入草稿
const inputElement = ref(null)                                       // 发送后恢复键盘焦点
const fileInput = ref(null)                                          // 隐藏原生文件选择器
const modelOptions = computed(() => props.models.map((item) => ({ value: `${item.provider}/${item.model}`, label: `${item.model} · ${item.provider}` }))) // 转换为通用选择目录


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
      <m3e-input-chip v-for="file in session.files" :key="file.id" removable :remove-label="t('removeFile', { name: file.name })" @remove="emit('remove-file', file.id)"><m3e-icon slot="icon" name="attach_file"></m3e-icon>{{ file.name }}</m3e-input-chip>
    </div>
    <TextAreaField ref="inputElement" v-model="content" class="composer__input" variant="filled" :min-rows="1" :max-rows="8" :label="t('message')" :placeholder="t('messagePlaceholder')" @keydown="handleKeydown" />
    <div class="composer__bar">
      <div class="composer__left">
        <input ref="fileInput" class="visually-hidden" type="file" multiple @change="selectFiles" />
        <m3e-icon-button class="icon-command" :aria-label="t('uploadFile')" :title="t('uploadFile')" @click="fileInput.click()"><m3e-icon name="attach_file"></m3e-icon></m3e-icon-button>
        <SelectField class="model-select" :model-value="`${session.provider}/${session.model}`" :options="modelOptions" :disabled="session.status === 'running'" :label="t('switchModel')" @change="emit('select-model', $event)" />
      </div>
      <m3e-icon-button v-if="session.status === 'running'" class="send-command is-stop" variant="tonal" :aria-label="t('pauseGeneration')" :title="t('pauseGeneration')" @click="emit('stop')"><m3e-icon name="stop"></m3e-icon></m3e-icon-button>
      <m3e-icon-button v-else class="send-command" variant="filled" :disabled="!content.trim()" :aria-label="t('send')" :title="t('send')" @click="submit"><m3e-icon name="arrow_upward"></m3e-icon></m3e-icon-button>
    </div>
  </div>
</template>

<style lang="scss" src="../../styles/components/InputBox.scss"></style>
