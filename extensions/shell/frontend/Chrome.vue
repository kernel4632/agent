<!--
壳的根：上面是标签栏，下面是当前页（会话列表、对话、设置，或别人登记的整页）。
权限询问等浮层画在内容区里，不挡住标签。对话页里把原版 App 的顶 padding 收小，因为已经有对话顶栏了。
-->
<script setup>
import { computed } from 'vue'
import { state } from './state.js'
import Bar from './Bar.vue'
import Chat from './Chat.vue'

const props = defineProps({
    shell: { type: Object, required: true },
    original: { type: Object, required: true },
    app: { type: Object, required: true },
})

const page = computed(() => state.pages.find(item => item.id === state.page && !item.parent) ?? null)
</script>

<template>
  <div class="chrome" :class="{ 'is-chat': state.page === 'session' }">
    <Bar :shell="shell" :app="app" />
    <div class="chrome__body">
      <Chat v-if="state.page === 'session'" :shell="shell" :original="original" :app="app" />
      <component v-else-if="page" :is="page.component" :app="app" :api="app.api" :shell="shell" />
      <Chat v-else :shell="shell" :original="original" :app="app" />
      <div v-for="item in state.overlays" :key="item.id" class="chrome__overlay">
        <component :is="item.component" :app="app" :api="app.api" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chrome { display: flex; flex-direction: column; height: 100dvh; background: var(--bg); }
.chrome__body { position: relative; flex: 1; min-height: 0; }
.chrome__overlay { position: absolute; inset: 0; pointer-events: none; }
.chrome__overlay > :deep(*) { pointer-events: auto; }
</style>

<style>
/* 原版 App 在无顶栏时给对话流留了 72px；套上壳之后顶栏已在外面，把这段空白收小。 */
.chrome.is-chat .app { height: 100%; }
.chrome.is-chat .app__flow { padding-top: 28px; }
</style>
