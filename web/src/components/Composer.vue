<!--
输入框，照 Grok 网页：始终与对话流同宽。单行是 58px 高、两端全圆的胶囊，只有加号、输入、发送；
一行放不下（或有附件）时加号和发送落到第二行，变成同一圆角的圆角矩形，输入区最高 176px 后在框内滚动；
一旦变成多行，要清空才收回胶囊，避免来回闪。发送在运行中变停止；输入为空而上次失败或被停下时，它就是“继续”。
两个圆钮照 grok.com 实测：都是 32px 圆、20px 图标、线宽折合 1.5px，状态切换没有过渡（颜色瞬间变）；
空着时发送钮是聊天底色的圆（不是透明），有字时实心蓝 #1084fe，悬停变亮。
加号菜单只放上传文件；拖拽和粘贴的文件也进到文字上方的附件区。
调用示例：<component :is="Components.Composer" />
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Agent } from '../Agent'
import Icon from './Icon.vue'
import { Add01Icon, ArrowUp02Icon, Attachment01Icon, Cancel01Icon, PlayIcon, StopIcon } from '@hugeicons/core-free-icons'
import { PlusMenu } from '../Extension'

const draft = ref('')
const files = ref<{ file: File; url?: string }[]>([])
const stacked = ref(false)
const menu = ref(false)
const dragging = ref(false)
const field = ref<HTMLTextAreaElement>()
const picker = ref<HTMLInputElement>()
const root = ref<HTMLElement>()

const filled = computed(() => Boolean(draft.value.trim() || files.value.length))
const last = computed(() => Agent.state.history.at(-1))
const resumable = computed(() => !Agent.state.running && (Agent.state.stopped || last.value?.role === 'error'))
const action = computed(() => Agent.state.running ? 'stop' : filled.value ? 'send' : resumable.value ? 'continue' : 'idle')

// 量一下：胶囊里放不下就换成两行布局；多行布局只在清空后收回。输入区高度随内容，到上限后滚动。
async function measure() {
  const element = field.value
  if (!element) return
  if (!filled.value) stacked.value = false
  else if (!stacked.value && (files.value.length || draft.value.includes('\n') || element.scrollHeight > element.clientHeight + 2)) stacked.value = true
  await nextTick()
  element.style.height = ''
  if (stacked.value) element.style.height = `${Math.min(element.scrollHeight, 176)}px`
}
watch([draft, () => files.value.length], measure, { flush: 'post' })

function add(list: FileList | File[] | null | undefined) {
  for (const file of Array.from(list ?? [])) files.value.push({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined })
  menu.value = false
  field.value?.focus()
}
function remove(index: number) {
  const [item] = files.value.splice(index, 1)
  if (item?.url) URL.revokeObjectURL(item.url)
}
function paste(event: ClipboardEvent) {
  if (!event.clipboardData?.files.length) return
  event.preventDefault()
  add(event.clipboardData.files)
}
function drop(event: DragEvent) { dragging.value = false; add(event.dataTransfer?.files) }

function submit() {
  if (action.value === 'stop') return Agent.stop()
  if (action.value === 'continue') return Agent.continue()
  if (action.value !== 'send') return
  Agent.send(draft.value.trim(), files.value.map(item => item.file))
  draft.value = ''
  for (const item of files.value) if (item.url) URL.revokeObjectURL(item.url)
  files.value = []
}
function enter(event: KeyboardEvent) {
  if (event.isComposing || event.shiftKey) return
  event.preventDefault()
  if (action.value !== 'stop') submit()
}

const close = (event: PointerEvent) => { if (!root.value?.contains(event.target as Node)) menu.value = false }
onMounted(() => { document.addEventListener('pointerdown', close); window.addEventListener('resize', measure); if (matchMedia('(pointer: fine)').matches) field.value?.focus() })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', measure) })
</script>

<template>
  <div ref="root" class="composer" :class="{ 'is-stacked': stacked, 'is-dragging': dragging }"
    @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="drop">
    <div v-if="files.length" class="composer__files">
      <div v-for="(item, index) in files" :key="index" class="composer__file" :class="{ 'is-image': item.url }">
        <img v-if="item.url" :src="item.url" alt="" />
        <span v-else>{{ item.file.name }}</span>
        <button class="hit" type="button" aria-label="移除" @click="remove(index)"><Icon :icon="Cancel01Icon" :size="14" /></button>
      </div>
    </div>
    <textarea ref="field" v-model="draft" class="composer__field" rows="1" placeholder="有什么想做的？" aria-label="输入消息"
      @keydown.enter="enter" @paste="paste" />
    <div class="composer__plus">
      <button class="composer__round composer__round--plus hit" type="button" aria-label="更多" :aria-expanded="menu" @click="menu = !menu">
        <Icon :icon="Add01Icon" :size="20" />
      </button>
      <div v-if="menu" class="composer__menu" role="menu">
        <button type="button" role="menuitem" @click="picker?.click()">
          <Icon :icon="Attachment01Icon" :size="18" />
          上传文件
        </button>
        <button v-for="item in PlusMenu" :key="item.id" type="button" role="menuitem" @click="menu = false; item.run()">{{ item.label }}</button>
      </div>
      <input ref="picker" type="file" multiple hidden @change="add(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''" />
    </div>
    <button class="composer__round composer__send hit" :class="`is-${action}`" type="button" :disabled="action === 'idle'"
      :aria-label="{ stop: '停止', send: '发送', continue: '继续', idle: '发送' }[action]" :title="action === 'continue' ? '继续' : undefined" @click="submit">
      <Icon v-if="action === 'stop'" :icon="StopIcon" :size="16" />
      <Icon v-else-if="action === 'continue'" :icon="PlayIcon" :size="17" />
      <Icon v-else :icon="ArrowUp02Icon" :size="20" />
    </button>
  </div>
</template>

<style scoped>
.composer { position: relative; display: grid; grid-template-columns: 32px 1fr 32px; grid-template-areas: 'plus field send'; align-items: center; column-gap: 10px; min-height: 58px; padding: 0 12px 0 11px; border: 1px solid var(--line); border-radius: 29px; background: var(--surface); box-shadow: 0 6px 14px -8px rgba(30, 25, 15, .14); transition: border-color .15s; }
.composer:focus-within { border-color: var(--line-strong); }
.composer.is-dragging { border-color: var(--accent); }
.composer.is-stacked { grid-template-columns: 32px 1fr 32px; grid-template-areas: 'files files files' 'field field field' 'plus . send'; align-items: end; row-gap: 0; min-height: 108px; padding: 14px 12px 12px; }
.composer__files { grid-area: files; display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; padding: 0 4px; }
.composer__file { position: relative; display: flex; align-items: center; max-width: 220px; height: 56px; padding: 0 30px 0 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--bg); font-size: 13px; color: var(--muted); }
.composer__file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer__file.is-image { width: 56px; padding: 0; overflow: hidden; }
.composer__file img { width: 100%; height: 100%; object-fit: cover; }
.composer__file button { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff; cursor: pointer; }
.composer__field { grid-area: field; align-self: center; height: 24px; max-height: 176px; padding: 0; border: 0; outline: 0; resize: none; overflow: hidden; background: none; color: var(--text); font: inherit; font-size: 15px; line-height: 24px; }
.composer__field::placeholder { color: var(--faint); }
.is-stacked .composer__field { height: auto; margin: 2px 0 10px; padding: 0 4px; overflow-y: auto; align-self: start; }
.composer__plus { grid-area: plus; position: relative; }
.composer__round { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; }
.composer__round--plus { background: var(--soft-strong); color: var(--text); }
.composer__round--plus:hover { background: var(--soft-hover); }
.composer__send { grid-area: send; background: var(--accent); color: var(--on-accent); }
.composer__send:hover { background: var(--accent-hover); }
.composer__send.is-idle { background: var(--bg); color: var(--faint); cursor: default; }
.composer__send.is-stop, .composer__send.is-stop:hover { background: var(--primary); color: var(--on-primary); }
.composer__send.is-stop :deep(svg *) { fill: currentColor; }
.composer__menu { position: absolute; bottom: calc(100% + 10px); left: -4px; z-index: 5; min-width: 200px; padding: 6px; border: 1px solid var(--line); border-radius: 18px; background: var(--pane); box-shadow: 0 12px 32px -12px rgba(30, 25, 15, .25); }
.composer__menu button { display: flex; align-items: center; gap: 12px; width: 100%; height: 44px; padding: 0 12px; border: 0; border-radius: 12px; background: none; color: var(--text); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.composer__menu button:hover { background: var(--hover); }
.composer__menu svg { color: var(--muted); }
</style>
