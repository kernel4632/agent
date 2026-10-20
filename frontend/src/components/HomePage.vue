<script setup>
import AppIcon from './AppIcon.vue'
</script>

<template>
  <section class="chat-intro" aria-label="新对话">
    <div class="chat-intro__prompt" aria-hidden="true">&gt;</div>
    <div class="chat-intro__body">
      <header class="chat-intro__author">
        <span class="chat-intro__mark" aria-hidden="true"><AppIcon name="spark" :size="13" /></span>
        <strong>la</strong>
        <span>终端工作区</span>
      </header>
      <h2>你好，今天想聊些什么？</h2>
      <p>输入消息开始，或用 <kbd>Ctrl K</kbd> 打开会话列表。</p>
      <div class="chat-intro__hints">
        <span><kbd>Enter</kbd> 发送</span>
        <span><kbd>Shift Enter</kbd> 换行</span>
        <span><kbd>N</kbd> 新对话</span>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.chat-intro {
  display: flex;
  gap: 10px;
  max-width: 1000px;
  margin: 0 auto;
  padding: 30px var(--la-chat-gutter);

  &__prompt { color: var(--la-accent); font: 600 16px/1.5 var(--la-font-mono); }
  &__body { min-width: 0; }
  &__author {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 9px;
    color: var(--la-muted);
    font: 10px/1.6 var(--la-font-mono);

    strong { color: var(--la-secondary); font-weight: 500; }
    > span:last-child { color: var(--la-muted); }
  }
  &__mark { display: grid; place-items: center; color: var(--la-accent); }

  h2 { margin: 0 0 6px; font: 500 20px/1.45 var(--la-font-mono); letter-spacing: -.02em; }
  p { margin: 0; color: var(--la-muted); font: 12px/1.8 var(--la-font-mono); }
  kbd { color: var(--la-secondary); font: inherit; }
  &__hints { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 18px; color: var(--la-muted); font: 10px/1.6 var(--la-font-mono); }
}
</style>
