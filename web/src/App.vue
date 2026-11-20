<!--
对话页本身：只有对话流和底部悬浮的输入区，没有顶栏；扩展要顶部区域就包一层 App。
对话流占满整个高度，上下留大 padding，底部 padding 跟着输入区实际高度走，最后一行永远不会被挡住。
滚动跟随到底；用户往上翻就脱离，再发送时恢复。全局配色和字体也在这里（参照 Grok 网页的中性色）。
-->
<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Agent } from './Agent'
import { Components } from './Extension'

const flow = ref<HTMLElement>()
const dock = ref<HTMLElement>()
const space = ref(160)
let follow = true

// 离底部不到 80px 就算在跟随；用户主动往上翻就不再自动滚。
function scroll() {
  const element = flow.value!
  follow = element.scrollHeight - element.scrollTop - element.clientHeight < 80
}
watch(() => Agent.state, async () => {
  if (!follow) return
  await nextTick()
  flow.value?.scrollTo({ top: flow.value.scrollHeight })
}, { deep: true })
watch(() => Agent.state.history.filter(message => message.role === 'user').length, () => { follow = true })

onMounted(() => new ResizeObserver(([entry]) => { space.value = entry!.contentRect.height + 72 }).observe(dock.value!))
</script>

<template>
  <main class="app">
    <div ref="flow" class="app__flow" :style="{ paddingBottom: `${space}px` }" @scroll="scroll">
      <div class="app__column">
        <p v-if="!Agent.state.history.length && !Agent.state.running" class="app__empty">有什么可以帮你？</p>
        <component :is="Components.History" v-else />
      </div>
    </div>
    <div ref="dock" class="app__dock">
      <div class="app__column">
        <component :is="Components.Composer" />
        <component :is="Components.Stats" />
      </div>
    </div>
  </main>
</template>

<style>
:root {
  --bg: #f9f8f6; --surface: #fefefc; --bubble: #efeeeb; --soft: #f1f0ed; --soft-hover: #e6e5e1;
  --line: #e2e1dd; --line-strong: #cfcdc8; --text: #2c2c2b; --icon: #4a4a48; --muted: #6f6e6a; --faint: #a3a29e;
  --accent: #1084fe; --warn: #b7791f; --danger: #c8443c; --danger-soft: #fcf1ef; --danger-line: #f1d3cf;
  --mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'Noto Sans Mono CJK SC', monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141413; --surface: #1d1d1c; --bubble: #262624; --soft: #242422; --soft-hover: #2f2f2d;
    --line: #2e2e2c; --line-strong: #444441; --text: #ecebe7; --icon: #d4d3cf; --muted: #a09f9a; --faint: #6c6b67;
    --danger: #ec7066; --danger-soft: #2a1b19; --danger-line: #4a2723; --warn: #d9a441;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif; -webkit-font-smoothing: antialiased; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.spinner { display: inline-block; width: 11px; height: 11px; border-radius: 50%; border: 1.6px solid var(--line); border-top-color: var(--text); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.app { position: relative; height: 100dvh; }
.app__flow { height: 100%; overflow-y: auto; padding-top: 72px; scrollbar-gutter: stable both-edges; }
.app__column { width: 100%; max-width: 796px; margin: 0 auto; padding: 0 16px; }
.app__empty { margin: 30vh 0 0; text-align: center; font-size: 28px; font-weight: 500; letter-spacing: -.01em; color: var(--text); }
.app__dock { position: absolute; left: 0; right: 0; bottom: 0; padding: 24px 0 max(6px, env(safe-area-inset-bottom)); background: linear-gradient(to bottom, transparent, var(--bg) 24px); scrollbar-gutter: stable both-edges; }
@media (max-width: 640px) {
  .app__flow { padding-top: 40px; }
  .app__column { padding: 0 12px; }
  .app__empty { font-size: 22px; }
}
</style>
