<!--
新会话空状态：居中的 sparkle 提示、底部输入栏和当前项目信息。
只负责显示和把输入事件上抛；创建会话、保存草稿、附件校验仍在 App.vue。
调用示例：
<DraftView
  ref="draftView"
  v-model:draft="draft"
  :workspace="selectedWorkspace"
  :model="store.config.activeModel"
  :busy="creating || store.ui.isLoading"
  :files="homeFiles"
  @submit="submitMessage"
  @attach="attachFiles"
  @remove-file="removeFile"
/>
-->
<script setup>
import { ref } from 'vue'
import { KimaChip } from '@kernel4632/kima'
import Composer from '../composer/Composer.vue'

defineProps({
  model: { type: String, default: '' },       // 新会话使用的模型
  busy: Boolean,                              // 创建中、加载中或有连接错误时禁用发送
  files: { type: Array, default: () => [] },  // 已经附上的文件
})
const emit = defineEmits(['submit', 'attach', 'remove-file'])
const draft = defineModel('draft', { type: String, default: '' })

const composer = ref(null)

// 建议只填入草稿并聚焦输入框，发送仍由用户自己决定。
const suggestions = ['帮我梳理一个计划', '解释这段代码', '写一个函数']
function useSuggestion(text) {
  draft.value = text
  composer.value?.focus()
}

// 打开草稿页后由 App 调用，把焦点交给输入框。
defineExpose({ focus: () => composer.value?.focus() })
</script>

<template>
  <section class="draft-panel" aria-label="新会话">
    <div class="draft-empty" aria-hidden="true"></div>

    <div class="draft-form">
      <div class="draft-suggestions" role="group" aria-label="建议">
        <KimaChip
          v-for="item in suggestions"
          :key="item"
          class="draft-suggestion"
          selectable
          :model-value="false"
          :label="item"
          @change="useSuggestion(item)"
        >{{ item }}</KimaChip>
      </div>
      <Composer ref="composer" v-model:draft="draft" :selected-model="model" :is-running="false" :busy="busy" :files="files" @submit="emit('submit', $event)" @attach="emit('attach', $event)" @remove-file="emit('remove-file', $event)" />
    </div>
  </section>
</template>

<style scoped lang="scss">
.draft-panel { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.draft-empty { min-height: 0; flex: 1; }
.draft-form { width: 100%; max-width: var(--la-chat-width); flex: none; margin: 0 auto; padding: 0 8px 8px; }
.draft-suggestions { display: flex; gap: 8px; overflow-x: auto; padding: 12px 12px 8px; scrollbar-width: none; }
.draft-suggestions::-webkit-scrollbar { display: none; }
.draft-suggestion { flex: none; }
@media (max-width: 767px) {
  .draft-form { padding: 0 8px max(8px, env(safe-area-inset-bottom)); }
}
</style>
