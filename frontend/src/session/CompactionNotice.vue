<!--
上下文压缩提示：像 OpenCode 一样用横向分隔线告诉用户这里发生过压缩，而不是伪装成一条用户消息。
摘要默认收起，点开才渲染，避免长会话把整段压缩正文塞进页面。
调用示例：<CompactionNotice :content="message.content" />
-->
<script setup>
import { ref } from 'vue'
import { AppIcon } from '../ui/index.js'

const props = defineProps({
  content: { type: String, default: '' },
})
const open = ref(false)
</script>

<template>
  <div class="compaction-notice" role="note" aria-label="上下文已压缩">
    <span class="compaction-notice__line" aria-hidden="true"></span>
    <button
      v-if="content"
      type="button"
      class="compaction-notice__button"
      :aria-expanded="open"
      @click="open = !open"
    >
      <AppIcon name="layers" :size="14" />
      <span>上下文已压缩</span>
      <AppIcon name="down" :size="12" class="compaction-notice__caret" :class="{ 'is-open': open }" aria-hidden="true" />
    </button>
    <span v-else class="compaction-notice__button">
      <AppIcon name="layers" :size="14" />
      <span>上下文已压缩</span>
    </span>
    <span class="compaction-notice__line" aria-hidden="true"></span>
  </div>
  <div v-if="open && content" class="compaction-summary">
    <strong>压缩摘要</strong>
    <p>{{ content }}</p>
  </div>
</template>

<style scoped lang="scss">
.compaction-notice { display: flex; width: 100%; align-items: center; gap: 10px; padding: 10px 0; color: var(--la-muted); }
.compaction-notice__line { height: 1px; flex: 1; background: var(--la-line); }
.compaction-notice__button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--la-muted);
  font: inherit;
  font-size: 11.5px;
  line-height: 18px;
  cursor: pointer;
}
.compaction-notice__button:hover { color: var(--la-text); background: var(--la-hover); }
.compaction-notice__caret { transition: transform var(--la-motion-enter) var(--kima-curve-standard); }
.compaction-notice__caret.is-open { transform: rotate(180deg); }
.compaction-summary {
  display: grid;
  gap: 6px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border: 1px solid var(--la-line);
  border-radius: 12px;
  background: var(--la-layer-01);
  color: var(--la-muted);
}
.compaction-summary strong { color: var(--la-secondary); font-size: 12px; font-weight: 650; }
.compaction-summary p { max-height: 260px; overflow: auto; margin: 0; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
