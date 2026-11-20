<!--
一次运行没能走完：最终失败（连同之前的自动重试合成一条，写明重试了几次）、用户停止、或推送断开。
停止不是失败，用中性色。最后一条且没在运行时带“继续”，等于不带输入再发一次。
调用示例：<component :is="Components.ErrorMessage" :errors="errors" :last="true" />
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { Alert02Icon, PlayIcon, StopCircleIcon } from '@hugeicons/core-free-icons'
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
      <Icon :icon="stopped ? StopCircleIcon : Alert02Icon" :size="16" />
      <span class="error__title">{{ title }}</span>
      <button v-if="reason" class="error__reason" type="button" :title="reason" @click="open = !open">{{ reason }}</button>
      <button v-if="last && !Agent.state.running" class="error__continue" type="button" title="不带新输入，从这里接着跑" @click="Agent.continue()">
        <Icon :icon="PlayIcon" :size="14" />继续
      </button>
    </div>
    <pre v-if="open" class="error__detail">{{ errors.map((error, index) => `${index + 1}. ${error.content}`).join('\n') }}</pre>
  </div>
</template>

<style scoped>
.error__line { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 6px 6px 14px; border-radius: 22px; background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); font-size: 14px; }
.is-stopped .error__line { background: var(--soft); color: var(--muted); }
.error__line > svg { flex: none; }
.error__title { flex: none; font-weight: 500; }
.error__reason { flex: 1; align-self: stretch; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: none; color: inherit; opacity: .75; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.error__continue { display: inline-flex; align-items: center; gap: 4px; flex: none; margin-left: auto; height: 32px; padding: 0 14px 0 10px; border: 0; border-radius: 16px; background: var(--primary); color: var(--on-primary); font: inherit; font-size: 13px; cursor: pointer; }
.error__detail { margin: 8px 0 0; padding: 10px 14px; border-radius: 14px; background: var(--soft); color: var(--muted); font: 12px/1.6 var(--mono); white-space: pre-wrap; }
</style>
