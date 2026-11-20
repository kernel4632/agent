<!--
上下文压缩：对话流里的一道分隔线，标明为什么压缩；点开看总结。
压缩进行中（compact-start 之后）显示“正在压缩”，总结边写边出现；完成后就是历史里的 compact 消息。
调用示例：<component :is="Components.CompactMessage" :message="message" />
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { HugeiconsIcon as Icon } from '@hugeicons/vue'
import { ArchiveIcon } from '@hugeicons/core-free-icons'
import type { CompactMessage } from '@kernel4632/agent-core'

const props = defineProps<{ message?: CompactMessage; reason?: string; text?: string }>()
const open = ref(false)
const reasons: Record<string, string> = { manual: '手动压缩', auto: '自动压缩', overflow: '超出上下文后压缩' }
const live = computed(() => !props.message)
const summary = computed(() => props.message?.content ?? props.text ?? '')
const title = computed(() => live.value ? `正在压缩上下文 · ${reasons[props.reason ?? ''] ?? ''}` : '上下文已压缩')
</script>

<template>
  <div class="compact" :class="{ 'is-live': live, 'is-open': open || live }">
    <button class="compact__line" type="button" :disabled="live" @click="open = !open">
      <span class="compact__rule" />
      <span class="compact__title"><Icon :icon="ArchiveIcon" :size="14" /><span :class="{ shimmer: live }">{{ title }}</span></span>
      <span class="compact__rule" />
    </button>
    <p v-if="(open || live) && summary" class="compact__summary">{{ summary }}</p>
  </div>
</template>

<style scoped>
.compact__line { display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px 0; border: 0; background: none; font: inherit; font-size: 12.5px; color: var(--faint); cursor: pointer; }
.compact__line:disabled { cursor: default; }
.compact__line:hover:enabled { color: var(--muted); }
.compact__rule { flex: 1; height: 1px; background: var(--line); }
.compact__title { display: inline-flex; align-items: center; gap: 6px; }
.compact__summary { margin: 6px 0 0; padding: 12px 16px; border-radius: 16px; background: var(--soft); color: var(--muted); font-size: 13.5px; line-height: 1.7; }
</style>
