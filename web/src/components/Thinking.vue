<!--
一段思考：正在思考时显示最新几行（淡色、不抢正文）；想完收成一行，点开看全文。
调用示例：<component :is="Components.Thinking" :text="text" :live="false" />
-->
<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ text: string; live: boolean }>()
const manual = ref<boolean | null>(null)
const open = computed(() => manual.value ?? false)
const preview = computed(() => props.text.trim().split('\n').at(-1) ?? '')
</script>

<template>
  <div class="thinking" :class="{ 'is-live': live, 'is-open': open }">
    <button class="thinking__head" type="button" @click="manual = !open">
      <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2.5a4 4 0 0 0-2.4 7.2c.4.3.6.7.6 1.2v.6h3.6v-.6c0-.5.2-.9.6-1.2A4 4 0 0 0 8 2.5zM6.4 13.5h3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span class="thinking__title">{{ live ? '思考中' : '思考' }}</span>
      <span v-if="!open" class="thinking__preview">{{ preview }}</span>
    </button>
    <p v-if="open" class="thinking__text">{{ text.trim() }}</p>
  </div>
</template>

<style scoped>
.thinking__head { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 28px; padding: 0; border: 0; background: none; font: inherit; font-size: 13px; color: var(--muted); text-align: left; cursor: pointer; }
.thinking__head svg { flex: none; color: var(--faint); }
.thinking__title { flex: none; }
.thinking__preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--faint); }
.is-live .thinking__title { color: var(--text); }
.is-live .thinking__preview { color: var(--muted); }
.thinking__text { margin: 2px 0 8px 22px; color: var(--muted); font-size: 13.5px; line-height: 1.7; white-space: pre-wrap; }
</style>
