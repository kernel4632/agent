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

<style scoped lang="scss" src="../styles/components/CompactionNotice.scss"></style>
