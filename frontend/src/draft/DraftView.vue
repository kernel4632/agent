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
import { computed, ref } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import Button from '../ui/Button.vue'
import Composer from '../composer/Composer.vue'
import { avatarColor, initial } from '../ui/avatar.js'

const props = defineProps({
  workspace: { type: Object, default: null }, // 当前选中的工作区，用来显示名称、路径和头像
  model: { type: String, default: '' },       // 新会话使用的模型
  busy: Boolean,                              // 创建中、加载中或有连接错误时禁用发送
  files: { type: Array, default: () => [] },  // 已经附上的文件
})
const emit = defineEmits(['submit', 'attach', 'remove-file'])
const draft = defineModel('draft', { type: String, default: '' })

const composer = ref(null)
// 项目名和头像共用同一个兜底，避免没有工作区时两处文字不一致。
const projectName = computed(() => props.workspace?.name || '本地工作区')

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
    <div class="draft-stage">
      <div class="draft-empty">
        <span class="draft-empty__icon" aria-hidden="true"><AppIcon name="spark" :size="30" /></span>
        <p>描述你想完成的任务，la 会和你一起一步步做。</p>
      </div>

      <div class="draft-form">
        <div class="draft-suggestions" role="group" aria-label="建议">
          <Button v-for="item in suggestions" :key="item" variant="plain" class="draft-suggestion" @click="useSuggestion(item)">{{ item }}</Button>
        </div>
        <Composer ref="composer" v-model:draft="draft" :selected-model="model" can-select-model :is-running="false" :busy="busy" :files="files" :context-tokens="0" @submit="emit('submit', $event)" @attach="emit('attach', $event)" @remove-file="emit('remove-file', $event)" />
        <div class="draft-meta">
          <span class="project-avatar" :style="{ background: avatarColor(workspace?.id) }" aria-hidden="true">{{ initial(projectName) }}</span>
          <span>{{ projectName }}</span>
          <span class="draft-meta__path">{{ workspace?.path }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.draft-panel { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.draft-stage { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.draft-empty {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 32px 24px;
  overflow-y: auto;
  text-align: center;
}
.draft-empty__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 18px;
  background: var(--la-layer-01);
  box-shadow: inset 0 0 0 .5px var(--la-line);
  color: var(--la-accent);
}
.draft-empty p { max-width: 420px; margin: 0; color: var(--la-muted); font-size: 13px; font-weight: 440; line-height: 20px; }
.draft-form { width: 100%; max-width: var(--la-chat-width); flex: none; margin: 0 auto; padding: 8px 20px 16px; }
.draft-suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-bottom: 8px; }
.draft-suggestion {
  height: 32px;
  padding: 0 14px;
  border: .5px solid var(--la-line);
  border-radius: 999px;
  background: var(--la-layer-01);
  color: var(--la-secondary);
  font-size: 12px;
  font-weight: 530;
  cursor: pointer;
}
.draft-suggestion:hover { background: var(--la-layer-02); color: var(--la-text); text-decoration: none; }
.draft-meta { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; color: var(--la-muted); font-size: 12px; font-weight: 440; }
.draft-meta__path { max-width: 50%; overflow: hidden; opacity: .7; text-overflow: ellipsis; white-space: nowrap; }
.project-avatar { display: grid; place-items: center; width: 16px; height: 16px; flex: 0 0 16px; border-radius: 4px; color: #fff; font: 600 8px/1 var(--la-font-mono); }
@media (max-width: 767px) {
  .draft-empty { padding: 24px 16px; }
  .draft-form { padding: 6px 8px max(10px, env(safe-area-inset-bottom)); }
  .draft-suggestions { gap: 6px; }
  .draft-suggestion { height: 30px; padding: 0 11px; font-size: 11px; }
  .draft-meta__path { display: none; }
}
</style>
