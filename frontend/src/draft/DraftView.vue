<!--
新会话草稿页：字标、输入区、当前项目路径。
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

// 打开草稿页后由 App 调用，把焦点交给输入框。
defineExpose({ focus: () => composer.value?.focus() })
</script>

<template>
  <section class="draft-panel" aria-label="新会话">
    <div class="draft-stage">
      <div class="draft-inner">
        <div class="draft-wordmark" aria-hidden="true">la</div>
        <div class="draft-form">
          <Composer ref="composer" v-model:draft="draft" :selected-model="model" can-select-model :is-running="false" :busy="busy" :files="files" :context-tokens="0" @submit="emit('submit', $event)" @attach="emit('attach', $event)" @remove-file="emit('remove-file', $event)" />
          <div class="draft-meta">
            <span class="project-avatar" :style="{ background: avatarColor(workspace?.id) }" aria-hidden="true">{{ initial(projectName) }}</span>
            <span>{{ projectName }}</span>
            <span class="draft-meta__path">{{ workspace?.path }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.draft-panel { position: relative; }
.draft-stage { display: flex; min-height: 100%; flex-direction: column; align-items: center; overflow: auto; padding: clamp(40px, 18vh, 180px) 24px 48px; }
.draft-inner { width: 100%; max-width: 880px; padding: 0; }
.draft-wordmark { width: 80%; max-width: 720px; margin: 0 auto; color: var(--la-text); font-family: var(--la-font-sans); font-size: clamp(120px, 18vw, 220px); font-weight: 700; line-height: .9; letter-spacing: -.08em; text-align: center; opacity: .11; user-select: none; }
.draft-form { position: relative; margin-top: 32px; }
.draft-meta { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 16px; color: var(--la-muted); font-size: 13px; font-weight: 440; }
.draft-meta__path { opacity: .7; }
.project-avatar { display: grid; place-items: center; width: 16px; height: 16px; flex: 0 0 16px; border-radius: 3px; color: #fff; font: 600 8px/1 var(--la-font-mono); }
@media (max-width: 767px) {
  .draft-stage { padding: clamp(32px, 12vh, 96px) 12px 32px; }
  .draft-wordmark { font-size: clamp(96px, 28vw, 160px); }
  .draft-meta__path { display: none; }
}
</style>
