<!--
会话输入区：消息输入、斜杠命令、附件、模型选择、发送和停止。
会话页和新建会话页共用；只通过 v-model:draft 和事件与外面交互。
消息编辑器和隐藏的 file input 是编辑器专用控件，保留原生实现，等后续编辑器组件到位后再替换。
调用示例：
<Composer
  ref="composer"
  v-model:draft="draft"
  :selected-model="model"
  :can-select-model="false"
  :is-running="false"
  :busy="false"
  :files="files"
  :context-tokens="0"
  @submit="submitMessage"
  @stop="stop"
  @attach="attachFiles"
  @remove-file="removeFile"
/>
-->
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { AppIcon, Button, Field, Sheet } from '../ui/index.js'
import { store } from '../store.js'
import { UI } from '../commands/ui.js'
import { Session } from '../commands/session.js'
import ComposerAttachments from './ComposerAttachments.vue'
import ComposerSlashMenu from './ComposerSlashMenu.vue'
import { ATTACHMENT_ACCEPT } from '../utils/attachments.js'

const props = defineProps({
  selectedModel: { type: String, default: '' },
  selectedProvider: { type: String, default: '' },
  sessionId: { type: String, default: '' },
  mode: { type: String, default: '' },
  showSessionControls: Boolean,
  isRunning: Boolean,
  busy: Boolean,
  files: { type: Array, default: () => [] },
})
const draft = defineModel('draft', { type: String, default: '' })
const emit = defineEmits(['submit', 'stop', 'attach', 'remove-file', 'toggle-settings', 'toggle-mode'])
const fileInput = ref(null)
const editor = ref(null)
const currentProvider = computed(() => props.selectedProvider || store.config.activeProvider)
const modelGroups = computed(() => Object.entries(store.config.providers)
  .filter(([, config]) => config.enabled)
  .map(([provider, config]) => ({
    provider,
    models: config.models
      .map(model => typeof model === 'string' ? model : model.id || model.name)
      .filter(model => !modelQuery.value.trim() || model.toLowerCase().includes(modelQuery.value.trim().toLowerCase())),
  }))
  .filter(group => group.models.length))

const modelOpen = ref(false)
const modelQuery = ref('')
const addOpen = ref(false)
const expanded = ref(false)
const placeholder = computed(() => store.commands?.length ? '输入消息与 AI 聊天，/ 使用命令' : '输入消息与 AI 聊天')

function toggleExpanded() {
  expanded.value = !expanded.value
  nextTick(() => editor.value?.focus())
}

function openModelSheet() {
  modelQuery.value = ''
  modelOpen.value = true
}

async function chooseModel(provider, model) {
  modelOpen.value = false
  if (props.sessionId) await Session.selectModel(props.sessionId, provider, model)
  else {
    store.config.activeProvider = provider
    store.config.activeModel = model
  }
  nextTick(() => editor.value?.focus())
}

// --- 斜杠命令菜单 ---
const slashIndex = ref(0)
const slashDismissed = ref(false)
const slashMatches = computed(() => {
  if (slashDismissed.value || !store.commands?.length) return []
  // 只在输入框里只有 /名字 时给提示；输入参数后菜单自动收起。
  const match = draft.value.match(/^\/([a-zA-Z0-9_-]*)$/)
  if (!match) return []
  const query = match[1].toLowerCase()
  return store.commands.filter(item => item.name.toLowerCase().startsWith(query)).slice(0, 8)
})

watch(draft, () => {
  slashDismissed.value = false
  slashIndex.value = 0
})

// 选中命令只补全名字，参数由用户接着输入；发送时再展开正文。
function chooseCommand(command) {
  draft.value = `/${command.name} `
  slashDismissed.value = true
  nextTick(() => editor.value?.focus())
}

// 把 /name 参数 展开成命令正文；不认识的命令原样发送。
function expand(text) {
  const match = text.match(/^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/)
  if (!match) return text
  const command = store.commands?.find(item => item.name === match[1])
  if (!command) return text
  const args = match[2].trim()
  if (command.prompt.includes('$ARGUMENTS')) return command.prompt.replaceAll('$ARGUMENTS', args)
  return args ? `${command.prompt}\n\n${args}` : command.prompt
}

function submit() {
  if (draft.value.trim() && props.selectedModel && !props.isRunning && !props.busy) emit('submit', expand(draft.value))
}
function keydown(event) {
  if (slashMatches.value.length) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      slashIndex.value = (slashIndex.value + 1) % slashMatches.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      slashIndex.value = (slashIndex.value - 1 + slashMatches.value.length) % slashMatches.value.length
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      chooseCommand(slashMatches.value[slashIndex.value])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      slashDismissed.value = true
      return
    }
  }
  if (event.key === 'Escape' && expanded.value) {
    event.preventDefault()
    expanded.value = false
    return
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() }
}
function addFiles(event) { emit('attach', [...event.target.files]); event.target.value = '' }
defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <form class="chat-composer" :class="{ 'is-expanded': expanded }" aria-label="对话编辑器" @submit.prevent="submit">
    <ComposerAttachments :files="files" @remove="emit('remove-file', $event)" />
    <Transition name="slash">
      <ComposerSlashMenu v-if="slashMatches.length" :matches="slashMatches" :active="slashIndex" @choose="chooseCommand" />
    </Transition>
    <!-- 编辑器专用原生 textarea：需要 ref、焦点、键盘和斜杠菜单，等编辑器组件到位后再换。 -->
    <div class="chat-composer__editor-wrap">
      <textarea ref="editor" v-model="draft" class="chat-composer__editor" aria-label="消息" :placeholder="placeholder" rows="2" @keydown="keydown"></textarea>
    </div>
    <div class="chat-composer__expand-corner">
      <span class="chat-composer__expand-line" aria-hidden="true"></span>
      <button
        type="button"
        class="chat-composer__expand-button"
        :aria-label="expanded ? '退出全屏输入' : '全屏输入'"
        :aria-pressed="expanded"
        :title="expanded ? '退出全屏输入' : '全屏输入'"
        @mousedown.prevent
        @click="toggleExpanded"
      >
        <AppIcon :name="expanded ? 'collapse' : 'fullscreen'" :size="12" />
      </button>
    </div>
    <div class="chat-composer__bottom">
      <div class="chat-composer__options">
        <button type="button" class="composer-option" :aria-label="`选择模型（当前 ${selectedModel || '未选择'}）`" title="选择模型" @click="openModelSheet"><AppIcon name="spark" :size="24" /></button>
      </div>
      <div class="chat-composer__right">
        <button type="button" class="composer-action" aria-label="更多选项" title="更多选项" :disabled="busy" @click="addOpen = true"><AppIcon name="plus" :size="18" /></button>
        <Transition name="send" mode="out-in">
          <Button v-if="isRunning" key="stop" variant="plain" class="chat-composer__send is-stop" type="button" aria-label="停止生成" @click="emit('stop')"><AppIcon name="stop" :size="18" /></Button>
          <Button v-else key="send" variant="plain" class="chat-composer__send" type="submit" aria-label="发送消息" :disabled="busy || !draft.trim() || !selectedModel"><AppIcon name="up" :size="18" /></Button>
        </Transition>
      </div>
    </div>
    <!-- 隐藏的 file input 是编辑器专用控件：由更多选项里的附件按钮触发，保留原生实现。 -->
    <input ref="fileInput" class="sr-only" type="file" multiple :accept="ATTACHMENT_ACCEPT" tabindex="-1" aria-label="选择文本附件" @change="addFiles" />
  </form>

  <Sheet :open="modelOpen" label="选择模型" @update:open="modelOpen = $event">
    <div class="composer-sheet composer-sheet--models">
      <Field v-model="modelQuery" type="search" label="搜索模型" placeholder="搜索模型">
        <template #leading><AppIcon name="search" :size="20" /></template>
      </Field>
      <div v-if="modelGroups.length" class="model-list">
        <section v-for="group in modelGroups" :key="group.provider" class="model-group">
          <h3>{{ group.provider }}</h3>
          <button v-for="model in group.models" :key="model" type="button" class="model-row" :class="{ 'is-selected': model === selectedModel && group.provider === currentProvider }" @click="chooseModel(group.provider, model)">
            <span class="model-row__icon"><AppIcon name="spark" :size="20" /></span>
            <span class="model-row__name">{{ model }}</span>
            <AppIcon v-if="model === selectedModel && group.provider === currentProvider" name="check" :size="20" />
          </button>
        </section>
      </div>
      <div v-else class="composer-sheet__empty">
        <p>还没有可用模型。</p>
        <Button @click="modelOpen = false; UI.openSettings('providers')">打开模型设置</Button>
      </div>
    </div>
  </Sheet>

  <Sheet :open="addOpen" label="更多选项" @update:open="addOpen = $event">
    <div class="composer-sheet">
      <div class="composer-sheet__list">
        <button type="button" :disabled="isRunning || busy" @click="addOpen = false; fileInput.click()"><AppIcon name="paperclip" :size="20" /><span>添加文本或代码文件</span></button>
        <button v-if="showSessionControls" type="button" @click="addOpen = false; emit('toggle-settings')"><AppIcon name="settings" :size="20" /><span>对话设置</span></button>
        <button v-if="showSessionControls" type="button" :title="mode ? `当前模式：${mode}` : undefined" @click="addOpen = false; emit('toggle-mode')"><AppIcon name="eye" :size="20" /><span>切换执行模式</span></button>
      </div>
    </div>
  </Sheet>
</template>

<style scoped lang="scss">
.chat-composer {
  position: relative;
  padding: 10px 12px 6px;
  border: 1px solid var(--la-line);
  border-radius: 20px;
  background: var(--la-panel);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .04);

  &:focus-within { border-color: var(--la-line-strong); }
  &__editor-wrap { position: relative; min-width: 0; }
  /* 全屏输入在原来的位置向上长高：只过渡高度，按钮和聊天内容跟着平滑移动。 */
  &__editor {
    display: block;
    width: 100%;
    min-height: 56px;
    max-height: 240px;
    padding: 8px 28px 10px 4px;
    resize: none;
    field-sizing: content;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--la-text);
    font: 16px/24px var(--la-font-sans);
    letter-spacing: 0;
    transition: min-height var(--la-motion-enter) var(--kima-curve-standard), max-height var(--la-motion-enter) var(--kima-curve-standard);

    &::placeholder { color: var(--la-muted); }
  }
  &.is-expanded &__editor {
    min-height: max(320px, calc(100dvh - var(--la-topbar-height, 64px) - 180px));
    max-height: max(320px, calc(100dvh - var(--la-topbar-height, 64px) - 180px));
    overflow-y: auto;
  }
  /* 右上角贴边圆角线；靠近时缩成半透明，并让展开按钮滑入。 */
  &__expand-corner {
    position: absolute;
    top: 1px;
    right: 1px;
    z-index: 4;
    width: 32px;
    height: 32px;
  }
  &__expand-line {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 12px;
    height: 12px;
    border-top: 1.5px solid color-mix(in srgb, var(--la-text) 60%, transparent);
    border-right: 1.5px solid color-mix(in srgb, var(--la-text) 60%, transparent);
    border-top-right-radius: 16px;
    opacity: .7;
    pointer-events: none;
    transform-origin: top right;
    transition: opacity var(--kima-duration-fast) var(--kima-curve-standard), transform var(--kima-duration-medium) var(--kima-curve-standard);
  }
  &__expand-button {
    position: absolute;
    top: 4px;
    right: 4px;
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--la-muted);
    opacity: 0;
    pointer-events: none;
    transform: translate(4px, -4px) scale(.8) rotate(-8deg);
    transition: opacity var(--kima-duration-medium) var(--kima-curve-standard), transform var(--kima-duration-slow) var(--kima-curve-emphasized), color var(--kima-duration-effects) var(--kima-curve-standard), background-color var(--kima-duration-effects) var(--kima-curve-standard);
  }
  &__expand-button:hover {
    background: var(--la-layer-03);
    color: var(--la-text);
  }
  &__expand-button :deep(svg) { transition: transform var(--kima-duration-medium) var(--kima-curve-emphasized); }
  &__expand-corner:hover &__expand-line,
  &__expand-corner:focus-within &__expand-line {
    opacity: 0;
    transform: scale(.5);
  }
  &__expand-corner:hover &__expand-button,
  &__expand-corner:focus-within &__expand-button {
    opacity: 1;
    pointer-events: auto;
    background: var(--la-layer-02);
    color: var(--la-text);
    box-shadow: 0 2px 6px rgba(0, 0, 0, .14);
    transform: none;
  }
  &__expand-corner:hover &__expand-button :deep(svg),
  &__expand-corner:focus-within &__expand-button :deep(svg) { transform: scale(1.1); }
  &__bottom { display: flex; min-height: 48px; align-items: center; gap: 8px; padding: 0 2px 2px; }
  &__options { display: flex; min-width: 0; flex: 1; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: none; }
  &__options::-webkit-scrollbar { display: none; }
  &__right { display: flex; flex: none; align-items: center; gap: 8px; }
  &__send {
    display: grid;
    place-items: center;
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--la-accent-solid);
    color: var(--la-on-action);
    cursor: pointer;
  }
  &__send:hover:not(:disabled) { background: color-mix(in srgb, var(--la-accent-solid) 88%, var(--la-on-action)); }
  &__send:disabled { background: var(--la-layer-02); color: var(--la-muted); }
  &__send.is-stop { background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
}
.composer-option, .composer-action {
  display: grid;
  flex: none;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--la-text);
  cursor: pointer;
}
.composer-option { width: 48px; height: 48px; }
.composer-action { width: 40px; height: 40px; }
.composer-option:hover:not(:disabled), .composer-action:hover:not(:disabled) { background: var(--la-hover); }
.composer-option.is-active, .composer-action.is-active { color: var(--la-accent); background: var(--la-accent-soft); }
.composer-option:disabled, .composer-action:disabled { opacity: .38; cursor: default; }
.composer-sheet { display: grid; width: 100%; gap: 16px; min-width: 0; padding-bottom: 8px; }
.composer-sheet--models { max-height: 70vh; grid-template-rows: auto minmax(0, 1fr); }
.composer-sheet h2 { margin: 0; color: var(--la-text); font-size: 20px; font-weight: 400; line-height: 28px; }
.composer-sheet__hint { margin: 0; color: var(--la-secondary); font-size: 14px; line-height: 22px; }
.composer-sheet__actions { display: flex; justify-content: flex-end; margin-top: 4px; }
.composer-sheet__empty { display: grid; gap: 16px; justify-items: start; padding: 16px 0; color: var(--la-secondary); }
.composer-sheet__empty p { margin: 0; font-size: 14px; }
.composer-sheet__list { display: grid; gap: 4px; }
.composer-sheet__list button { display: flex; min-height: 56px; align-items: center; gap: 16px; padding: 0 12px; border: 0; border-radius: 12px; background: transparent; color: var(--la-text); text-align: left; font-size: 15px; cursor: pointer; }
.composer-sheet__list button:hover:not(:disabled) { background: var(--la-hover); }
.composer-sheet__list button:disabled { opacity: .38; cursor: default; }
.model-list { display: flex; min-height: 0; flex-direction: column; gap: 8px; overflow-y: auto; padding-bottom: 8px; }
.model-group { display: grid; flex: none; gap: 6px; }
.model-group h3 { position: static; margin: 0; padding: 4px 16px; background: transparent; color: var(--la-muted); font-size: 13px; font-weight: 600; line-height: 18px; }
.model-row { display: flex; min-height: 68px; align-items: center; gap: 14px; padding: 10px 16px; border: 0; border-radius: 14px; background: transparent; color: var(--la-text); text-align: left; font-size: 15px; cursor: pointer; }
.model-row:hover { background: var(--la-hover); }
.model-row.is-selected { background: var(--la-accent-soft); color: var(--md-sys-color-on-primary-container); }
.model-row__icon { display: grid; width: 44px; height: 44px; flex: 0 0 44px; place-items: center; border-radius: 12px; background: color-mix(in srgb, var(--la-accent) 14%, transparent); color: var(--la-accent); }
.model-row__name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 斜杠菜单和发送/停止按钮的切换都从操作点附近出现。 */
.slash-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard), transform var(--la-motion-enter) var(--kima-curve-standard); }
.slash-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard), transform var(--la-motion-exit) var(--kima-curve-standard); }
.slash-enter-from, .slash-leave-to { opacity: 0; transform: translateY(var(--la-motion-rise-small)); }
.send-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard), transform var(--la-motion-enter) var(--kima-curve-emphasized); }
.send-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard), transform var(--la-motion-exit) var(--kima-curve-standard); }
.send-enter-from, .send-leave-to { opacity: 0; transform: scale(.86); }
@media (prefers-reduced-motion: reduce) {
  .slash-enter-active, .slash-leave-active, .send-enter-active, .send-leave-active { transition-duration: .01ms; }
}
@media (max-width: 767px) {
  .chat-composer {
    padding: 8px 10px 4px;
    &__editor { font-size: 16px; }
    &__send { width: 44px; height: 44px; flex-basis: 44px; }
  }
  .composer-option { width: 44px; height: 44px; }
}
@media (hover: none) {
  .chat-composer__expand-line { opacity: 0; }
  .chat-composer__expand-button {
    top: 0;
    right: 0;
    width: 32px;
    height: 32px;
    opacity: 1;
    pointer-events: auto;
    background: var(--la-layer-02);
    color: var(--la-text);
    transform: none;
  }
}
</style>
