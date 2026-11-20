<!--
一条用户消息：靠右的浅色气泡，附件在文字上方。下方常驻一个淡色的“编辑”（触摸没有悬停，所以不藏），，改完从这条重发（之后的历史被截掉）。
调用示例：<component :is="Components.UserMessage" :message="message" />
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Message } from '@kernel4632/agent-core'
import Icon from './Icon.vue'
import { PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { Agent } from '../Agent'

const props = defineProps<{ message: Message }>()
const editing = ref(false)
const draft = ref('')
const field = ref<HTMLTextAreaElement>()
const parts = computed(() => typeof props.message.content === 'string' ? [{ type: 'text', text: props.message.content }] : props.message.content as any[])
const text = computed(() => parts.value.filter(part => part.type === 'text').map(part => part.text).join('\n'))
const files = computed(() => parts.value.filter(part => part.type === 'image' || part.type === 'file'))

async function edit() {
  draft.value = text.value
  editing.value = true
  await nextTick()
  field.value?.focus()
}
function resend() {
  if (!draft.value.trim()) return
  editing.value = false
  Agent.resend(props.message.id, draft.value.trim())
}
</script>

<template>
  <div class="user" :class="{ 'is-editing': editing }">
    <div v-if="files.length" class="user__files">
      <template v-for="(file, index) in files" :key="index">
        <img v-if="file.type === 'image'" class="user__image" :src="String(file.image)" alt="" />
        <span v-else class="user__file">{{ file.filename ?? '文件' }}</span>
      </template>
    </div>
    <form v-if="editing" class="user__edit" @submit.prevent="resend">
      <textarea ref="field" v-model="draft" rows="3" @keydown.enter.exact.prevent="resend" @keydown.esc="editing = false" />
      <div class="user__actions">
        <button type="button" @click="editing = false">取消</button>
        <button type="submit" class="is-primary" :disabled="Agent.state.running">重新发送</button>
      </div>
    </form>
    <template v-else>
      <div v-if="text" class="user__bubble">{{ text }}</div>
      <button class="user__tool hit" type="button" title="编辑后重新发送" aria-label="编辑" :disabled="Agent.state.running" @click="edit"><Icon :icon="PencilEdit01Icon" :size="16" /></button>
    </template>
  </div>
</template>

<style scoped>
.user { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; margin-top: 8px; }
.user__bubble { max-width: min(85%, 600px); padding: 10px 16px; border-radius: 24px; background: var(--bubble); color: var(--text); font-size: 16px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.user__files { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.user__image { width: 120px; height: 120px; object-fit: cover; border-radius: 16px; border: 1px solid var(--line); }
.user__file { padding: 8px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); font-size: 13px; color: var(--muted); }
.user__tool { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 16px; background: none; color: var(--ghost); cursor: pointer; transition: color .15s; }
.user:hover .user__tool:enabled, .user__tool:focus-visible { color: var(--faint); }
.user__tool:disabled { visibility: hidden; }
.user__tool:hover { color: var(--text); background: var(--hover); }
.user__edit { width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 24px; background: var(--surface); }
.user__edit textarea { width: 100%; border: 0; outline: 0; resize: none; background: none; color: var(--text); font: inherit; font-size: 16px; line-height: 1.7; }
.user__actions { display: flex; justify-content: flex-end; gap: 8px; }
.user__actions button { height: 36px; padding: 0 16px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; }
.user__actions .is-primary { border-color: transparent; background: var(--primary); color: var(--on-primary); }
.user__actions button:disabled { opacity: .4; cursor: default; }
</style>
