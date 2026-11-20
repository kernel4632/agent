<!--
一段思考，参照 RikkaHub 的思考卡片：
- 正在思考：半展开，固定高度的小窗只露最新几行并跟着滚到底，顶部渐隐；标题取思考里最新的 **加粗小标题**。
- 正文用和回答同一个 Markdown 解析（markstream-vue），但不上色：思考是次要信息，只保留加粗和行内代码的区分。
- 想完：收成一行，只留标题或第一句；点开看全文，再点收起。用户点过之后以用户为准。
调用示例：<component :is="Components.Thinking" :text="text" :live="false" />
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import MarkdownRender from 'markstream-vue'
import { HugeiconsIcon as Icon } from '@hugeicons/vue'
import { ArrowRight01Icon, Idea01Icon } from '@hugeicons/core-free-icons'

const props = defineProps<{ text: string; live: boolean }>()
const manual = ref<boolean | null>(null)
const window_ = ref<HTMLElement>()
const mode = computed(() => manual.value ? 'full' : manual.value === false ? 'closed' : props.live ? 'preview' : 'closed')
const title = computed(() => [...props.text.matchAll(/\*\*([^*\n]{2,40})\*\*/g)].at(-1)?.[1])
const summary = computed(() => title.value ?? props.text.trim().split(/[。.!！?？\n]/)[0])

// 小窗跟着最新内容滚到底。
watch(() => props.text, async () => {
  if (mode.value !== 'preview') return
  await nextTick()
  window_.value?.scrollTo({ top: window_.value.scrollHeight })
}, { immediate: true })
</script>

<template>
  <div class="thinking" :class="`is-${mode}`">
    <button class="thinking__head" type="button" :aria-expanded="mode === 'full'" @click="manual = mode !== 'full'">
      <Icon :icon="Idea01Icon" :size="16" />
      <span v-if="live" class="shimmer">{{ title ?? '正在思考' }}</span>
      <span v-else class="thinking__summary">{{ summary }}</span>
      <Icon class="thinking__chevron" :icon="ArrowRight01Icon" :size="14" />
    </button>
    <div v-if="mode !== 'closed'" ref="window_" class="thinking__body">
      <MarkdownRender mode="chat" html-policy="escape" render-code-blocks-as-pre :content="text.trim()" :final="!live" :fade="false" :typewriter="false" :smooth-streaming="false" :viewport-priority="false" />
    </div>
  </div>
</template>

<style scoped>
.thinking__head { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 30px; padding: 0; border: 0; background: none; font: inherit; font-size: 13px; color: var(--faint); text-align: left; cursor: pointer; }
.thinking__head > svg { flex: none; }
.thinking__head:hover { color: var(--muted); }
.thinking__summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thinking__chevron { opacity: 0; transition: transform .2s ease, opacity .15s; }
.thinking__head:hover .thinking__chevron, .is-full .thinking__chevron { opacity: 1; }
.is-full .thinking__chevron { transform: rotate(90deg); }
.thinking__body { margin: 0 0 8px 26px; color: var(--muted); font-size: 13px; line-height: 1.7; }
.thinking__body :deep(.markstream-vue) { --ms-text-body: 13px; --ms-leading-body: 1.7; font-size: inherit; line-height: inherit; }
.thinking__body :deep(.paragraph-node) { margin: 0 0 6px; font-size: inherit; line-height: inherit; }
.thinking__body :deep(.strong-node) { font-weight: 550; color: var(--text); }
.thinking__body :deep(.inline-code) { padding: 0 4px; border-radius: 5px; background: var(--soft); color: inherit; font: .9em var(--mono); }
.is-preview .thinking__body { max-height: 110px; overflow: hidden; -webkit-mask-image: linear-gradient(to bottom, transparent, #000 44px); mask-image: linear-gradient(to bottom, transparent, #000 44px); }
</style>
