<!--
一次运行没能走完：最终失败（连同之前的自动重试合成一条，写明重试了几次）、用户停止、或推送断开。
停止不是失败，用中性色。最后一条且没在运行时带“继续”，等于不带输入再发一次。
调用示例：<component :is="Components.ErrorMessage" :errors="errors" :last="true" />
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ErrorMessage } from '@kernel4632/agent-core'
import { Agent } from '../Agent'

const props = defineProps<{ errors: ErrorMessage[]; text?: string; stopped?: boolean; last?: boolean }>()
const open = ref(false)
const title = computed(() => props.stopped ? '已停止' : props.text ?? `请求失败${props.errors.length > 1 ? `，已自动重试 ${props.errors.length - 1} 次` : ''}`)
const reason = computed(() => props.errors.at(-1)?.content ?? '')
</script>

<template>
  <div class="error" :class="{ 'is-stopped': stopped }">
    <div class="error__line">
      <svg v-if="stopped" viewBox="0 0 16 16" width="14" height="14"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
      <svg v-else viewBox="0 0 16 16" width="14" height="14"><path d="M8 4.5v4M8 11.2v.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
      <span class="error__title">{{ title }}</span>
      <button v-if="reason" class="error__reason" type="button" :title="reason" @click="open = !open">{{ reason }}</button>
      <button v-if="last && !Agent.state.running" class="error__continue" type="button" @click="Agent.continue()">继续</button>
    </div>
    <pre v-if="open" class="error__detail">{{ errors.map((error, index) => `${index + 1}. ${error.content}`).join('\n') }}</pre>
  </div>
</template>

<style scoped>
.error__line { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 6px 4px 14px; border: 1px solid var(--danger-line); border-radius: 18px; background: var(--danger-soft); color: var(--danger); font-size: 14px; }
.is-stopped .error__line { border-color: var(--line); background: transparent; color: var(--muted); }
.error__line svg { flex: none; }
.error__title { flex: none; font-weight: 500; }
.error__reason { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: none; color: inherit; opacity: .75; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.error__continue { flex: none; margin-left: auto; height: 28px; padding: 0 14px; border: 0; border-radius: 14px; background: var(--text); color: var(--bg); font: inherit; font-size: 13px; cursor: pointer; }
.error__detail { margin: 8px 0 0; padding: 10px 14px; border-radius: 14px; background: var(--soft); color: var(--muted); font: 12px/1.6 var(--mono); white-space: pre-wrap; }
</style>
