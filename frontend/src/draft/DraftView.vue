<!--
新会话空状态：空白画布和底部输入栏，不显示建议或欢迎文案。
只负责显示和把输入事件上抛；创建会话、保存草稿、附件校验仍在 App.vue。
调用示例：
<DraftView
  ref="draftView"
  v-model:draft="draft"
  :model="store.config.activeModel"
  :busy="creating || store.ui.isLoading"
  :files="homeFiles"
  @submit="submitMessage"
  @attach="attachFiles"
  @remove-file="removeFile"
/>
-->
<script setup>
import { computed, ref } from 'vue'
import Composer from '../composer/Composer.vue'
import { Session } from '../commands/session.js'

const props = defineProps({
  model: { type: String, default: '' },       // 新会话使用的模型
  mode: { type: String, default: 'build' },  // 新会话默认模式，发送时随会话一起保存
  autoApprove: { type: Object, default: () => ({}) }, // 新会话默认自动批准分类
  busy: Boolean,                              // 创建中、加载中或有连接错误时禁用发送
  files: { type: Array, default: () => [] },  // 已经附上的文件
})
const emit = defineEmits(['submit', 'attach', 'remove-file', 'update:mode', 'update:autoApprove'])
const draft = defineModel('draft', { type: String, default: '' })

const composer = ref(null)
const modeLabel = computed(() => Session.modeLabel(props.mode))

function toggleAutoApprove(kind) {
  emit('update:autoApprove', { ...props.autoApprove, [kind]: !props.autoApprove?.[kind] })
}

// 打开草稿页后由 App 调用，把焦点交给输入框。
defineExpose({ focus: () => composer.value?.focus() })
</script>

<template>
  <section class="draft-panel" aria-label="新会话">
    <div class="draft-empty" aria-hidden="true"></div>

    <div class="draft-form">
      <Composer
        ref="composer"
        v-model:draft="draft"
        :selected-model="model"
        :mode="modeLabel"
        :mode-id="mode"
        :auto-approve="autoApprove"
        :is-running="false"
        :busy="busy"
        :files="files"
        show-session-controls
        @submit="emit('submit', $event)"
        @attach="emit('attach', $event)"
        @remove-file="emit('remove-file', $event)"
        @select-mode="emit('update:mode', $event)"
        @toggle-permission="toggleAutoApprove"
      />
    </div>
  </section>
</template>

<style scoped lang="scss">
.draft-panel { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.draft-empty { min-height: 0; flex: 1; }
.draft-form { width: 100%; flex: none; padding: 0 var(--la-chat-gutter) 8px; }
@media (max-width: 767px) {
  .draft-form { padding: 0 16px max(8px, env(safe-area-inset-bottom)); }
}
</style>
