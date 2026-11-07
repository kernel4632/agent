<!--
路径选择器：通过服务端只读列目录，支持目录和文件两种模式。
不读取文件内容，也不依赖浏览器 File System API。
调用：<PathPicker :open="open" mode="directory" :initial-path="path" @select="path = $event" @update:open="open = $event" />。
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AgentAPI } from '../utils/api.js'
import Button from './Button.vue'
import Dialog from './Dialog.vue'
import Field from './Field.vue'
import Icon from './Icon.vue'

const props = defineProps({
  open: Boolean,
  mode: { type: String, default: 'directory' },
  title: { type: String, default: '选择文件夹' },
  initialPath: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'select'])

const current = ref('')
const parent = ref(null)
const home = ref('')
const roots = ref([])
const entries = ref([])
const pathDraft = ref('')
const selected = ref('')
const loading = ref(false)
const error = ref('')
const truncated = ref(false)
let requestToken = 0
let typingTimer = null

const selectedName = computed(() => entries.value.find(item => item.path === selected.value)?.name || '')

async function load(path = pathDraft.value) {
  const token = ++requestToken
  loading.value = true
  error.value = ''
  selected.value = ''
  try {
    const data = await AgentAPI.getFilesystemEntries({ path, mode: props.mode })
    if (token !== requestToken) return
    current.value = data.current
    parent.value = data.parent
    home.value = data.home
    roots.value = data.roots || []
    entries.value = data.entries || []
    truncated.value = Boolean(data.truncated)
    pathDraft.value = data.current
  } catch (problem) {
    if (token === requestToken) error.value = problem.message
  } finally {
    if (token === requestToken) loading.value = false
  }
}

function onInput(value) {
  pathDraft.value = value
  selected.value = ''
  loading.value = false
  error.value = ''
  requestToken += 1
  clearTimeout(typingTimer)
  typingTimer = setTimeout(() => {
    if (props.open && pathDraft.value === value && value !== current.value) void load(value)
  }, 300)
}

function runNow() {
  clearTimeout(typingTimer)
  void load(pathDraft.value)
}

watch(() => props.open, open => {
  clearTimeout(typingTimer)
  if (!open) {
    requestToken += 1
    return
  }
  pathDraft.value = props.initialPath || ''
  current.value = ''
  entries.value = []
  selected.value = ''
  void load(pathDraft.value)
}, { immediate: true })

onBeforeUnmount(() => clearTimeout(typingTimer))

function enter(entry) {
  if (entry.type === 'directory') return void load(entry.path)
  selected.value = entry.path
  pathDraft.value = entry.path
}

function choose() {
  const path = props.mode === 'directory' ? current.value : selected.value
  if (!path) return
  emit('select', path)
  emit('update:open', false)
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" :label="title" :width="680" class="path-picker-dialog" @update:open="emit('update:open', $event)">
    <div class="path-picker">
      <div class="path-picker__toolbar">
        <Button variant="text" :disabled="!parent || loading" @click="load(parent)"><Icon name="up" :size="16" />上一级</Button>
        <Button variant="text" :disabled="loading || !home" @click="load(home)"><Icon name="home" :size="16" />主目录</Button>
        <span class="path-picker__roots">
          <button v-for="root in roots" :key="root" type="button" :disabled="loading" @click="load(root)">{{ root }}</button>
        </span>
      </div>
      <Field
        :model-value="pathDraft"
        label="路径"
        placeholder="输入绝对路径，例如 D:\\AgentSessions"
        @update:model-value="onInput"
        @keydown.enter.prevent="runNow"
      />
      <div class="path-picker__list" role="listbox" :aria-label="mode === 'directory' ? '文件夹' : '文件和文件夹'">
        <button
          v-for="entry in entries"
          :key="entry.path"
          type="button"
          role="option"
          :aria-selected="entry.path === selected"
          :class="{ 'is-selected': entry.path === selected, 'is-file': entry.type === 'file' }"
          @click="enter(entry)"
        >
          <Icon :name="entry.type === 'directory' ? 'folder' : 'document'" :size="18" />
          <span>{{ entry.name }}</span>
          <Icon v-if="entry.type === 'directory'" name="arrow" :size="14" />
        </button>
        <p v-if="!loading && !entries.length" class="path-picker__empty">这个位置没有可选的{{ mode === 'directory' ? '文件夹' : '文件' }}</p>
        <p v-if="truncated" class="path-picker__empty">项目太多，只显示前 500 项</p>
      </div>
      <p v-if="loading" class="path-picker__status" role="status">正在读取…</p>
      <p v-if="error" class="path-picker__error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <span class="path-picker__selected">{{ mode === 'file' && selected ? `已选择：${selectedName}` : current }}</span>
      <Button variant="text" @click="close">取消</Button>
      <Button :disabled="loading || (mode === 'file' ? !selected : !current)" @click="choose">{{ mode === 'directory' ? '选择此文件夹' : '选择此文件' }}</Button>
    </template>
  </Dialog>
</template>

<style scoped lang="scss" src="../styles/ui/PathPicker.scss"></style>
