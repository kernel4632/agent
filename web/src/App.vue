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
  /* 取自 grok.com 运行时的 --grok-* 设计变量（浅色 / 深色各量一次），名字改成本项目的用途 */
  --bg: #f9f8f7;                          /* --grok-bg-chat */
  --surface: #fefefc;                     /* --grok-bg-elevated：输入框 */
  --pane: #fefefc;                        /* --grok-bg-pane：弹出面板 */
  --bubble: #f0efed;                      /* --surface-user-bubble */
  --soft: rgba(51, 34, 0, .06);           /* --grok-bg-tertiary：代码、输出块 */
  --soft-strong: rgba(38, 26, 0, .08);    /* --grok-bg-secondary：加号按钮 */
  --hover: rgba(39, 20, 0, .05);          /* --grok-bg-hover */
  --line: #e6e5e3;                        /* --grok-border-secondary：输入框边框 */
  --line-soft: #f0efed;                   /* --grok-border-tertiary */
  --line-strong: #d4d3cf;                 /* --grok-border-primary */
  --text: #2c2c2b;                        /* --grok-text-primary */
  --muted: rgba(44, 44, 42, .62);         /* --grok-text-secondary */
  --faint: rgba(43, 43, 43, .44);         /* --grok-text-tertiary */
  --ghost: rgba(43, 43, 43, .18);         /* --grok-text-quaternary */
  --primary: #2c2c2b; --on-primary: #fff; /* --grok-bg-primary / --grok-text-on-primary：停止按钮 */
  --accent: #1084fe; --on-accent: #fff;   /* --grok-bg-accent-primary：发送按钮 */
  --danger: #ff263c; --warn: #d77f02; --success: #05a95f;
  --mono: ui-monospace, 'SF Mono', 'IBM Plex Mono', Menlo, Consolas, 'Noto Sans Mono CJK SC', monospace;
  /* Markdown 与代码高亮：沿用旧前端 --md-* 的分工，色相收成暖橙/蓝/绿三支，压暗到在 Grok 暖白底上读得清 */
  --md-heading: #b35c00; --md-strong: #b35c00; --md-em: #8a6a1f; --md-list: #c97a2a;
  --md-link: #0b6fdc; --md-code: #1d8048; --md-quote: #d9b26a;
  --md-keyword: #a626a4; --md-function: #2f62c8; --md-string: #3a8433; --md-number: #b35c00;
  --md-type: #9a6700; --md-variable: #c43b48; --md-operator: #0f7f8c; --md-comment: #8c8a85;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1e1d1d; --surface: #191919; --pane: #282726; --bubble: #282726;
    --soft: rgba(255, 255, 255, .06); --soft-strong: rgba(255, 255, 255, .08); --hover: rgba(255, 255, 255, .06);
    --line: #383836; --line-soft: rgba(255, 255, 255, .06); --line-strong: #5f5e59;
    --text: #e6e5e3; --muted: rgba(230, 229, 227, .65); --faint: rgba(229, 229, 227, .47); --ghost: rgba(232, 232, 225, .13);
    --primary: #e6e5e3; --on-primary: #1e1d1d; --on-accent: #1e1d1d;
    --warn: #ff9800; --success: #00c972;
    --md-heading: #f2a65a; --md-strong: #f2a65a; --md-em: #e3c47f; --md-list: #c98a4a;
    --md-link: #5aa9ff; --md-code: #7fd39b; --md-quote: #8a6d3b;
    --md-keyword: #c792ea; --md-function: #82aaff; --md-string: #a8d68a; --md-number: #f2a65a;
    --md-type: #e5c07b; --md-variable: #f07c87; --md-operator: #67c6d0; --md-comment: #7d7b77;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif; font-size: 15px; -webkit-font-smoothing: antialiased; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.spinner { display: inline-block; flex: none; width: 12px; height: 12px; margin: 2px; border-radius: 50%; border: 1.5px solid var(--ghost); border-top-color: var(--text); animation: spin .8s linear infinite; }
.shimmer { background: linear-gradient(90deg, var(--faint) 0%, var(--faint) 40%, var(--text) 50%, var(--faint) 60%, var(--faint) 100%); background-size: 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shimmer 2s linear infinite; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
@keyframes spin { to { transform: rotate(360deg); } }

.app { position: relative; height: 100dvh; }
.app__flow { height: 100%; overflow-y: auto; padding-top: 72px; scrollbar-gutter: stable both-edges; }
.app__column { width: 100%; max-width: 796px; margin: 0 auto; padding: 0 16px; }
.app__empty { margin: 30vh 0 0; text-align: center; font-size: 28px; font-weight: 450; letter-spacing: -.01em; color: var(--text); }
.app__dock { position: absolute; left: 0; right: 0; bottom: 0; padding: 24px 0 max(6px, env(safe-area-inset-bottom)); background: linear-gradient(to bottom, transparent, var(--bg) 24px); scrollbar-gutter: stable both-edges; }
@media (max-width: 640px) {
  .app__flow { padding-top: 40px; }
  .app__column { padding: 0 12px; }
  .app__empty { font-size: 22px; }
}
</style>
