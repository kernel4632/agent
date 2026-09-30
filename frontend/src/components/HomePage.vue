<template>
  <section class="chat-intro" aria-label="新对话">
    <header class="chat-intro__author">
      <span class="avatar avatar--assistant" aria-hidden="true">la</span>
      <strong>la</strong>
      <span>你的 AI 助手</span>
    </header>
    <h2>你好，今天想聊些什么？</h2>
    <p>输入消息，或添加一份文件开始对话。</p>
  </section>
</template>

<style scoped lang="scss">
.chat-intro {
   padding: 36px var(--la-chat-gutter);

  &__author {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;

    strong { font-size: 14px; font-weight: 550; }
    > span:last-child { color: var(--la-muted); font-size: 12px; }
  }

  h2 { margin: 0 0 8px; font-size: 16px; font-weight: 450; }
  p { margin: 0; color: var(--la-muted); font-size: 13px; line-height: 1.8; }
}
</style>
