<script setup>
import AppIcon from './AppIcon.vue'
</script>

<template>
  <section class="chat-intro" aria-label="新对话">
    <header class="chat-intro__author">
      <span class="avatar avatar--assistant" aria-hidden="true"><AppIcon name="spark" :size="14" /></span>
      <strong>la</strong>
      <span>你的 AI 助手</span>
    </header>
    <h2>你好，今天想聊些什么？</h2>
    <p>输入消息，或添加一份文件开始对话。</p>
  </section>
</template>

<style scoped lang="scss">
.chat-intro {
  max-width: 820px;
  margin: 0 auto;
  padding: 32px var(--la-chat-gutter);

  &__author {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 14px;

    strong { font-size: 13px; font-weight: 550; }
    > span:last-child { color: var(--la-muted); font-size: 11px; }
  }

  h2 { margin: 0 0 7px; font-size: 17px; font-weight: 500; letter-spacing: -.01em; }
  p { margin: 0; color: var(--la-muted); font-size: 12px; line-height: 1.8; }
}
</style>
