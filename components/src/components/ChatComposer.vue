<!--
对话编辑器：复刻通用 Agent 对话框的视觉结构，不包含发送、上传或模型切换业务逻辑。
编辑区负责承载可增长文本，底部工具栏始终贴住容器底边，空状态时两者自然叠成单行胶囊。
调用示例：<ChatComposer />。
-->
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue' // 观察 textarea 的原生内容尺寸

const editor = ref(null)                                      // 原生 textarea 元素
const message = ref('')                                       // 保存输入文本
const expanded = ref(false)                                   // 第二行出现后切换为上下结构
const composerHeight = ref('64px')                            // 根据 textarea 实际高度驱动外框过渡
const emit = defineEmits(['submit'])                           // 将提交意图交给未来接入的业务层
let resizeObserver


function observeEditorSize() {
  const element = editor.value
  if (!element) return

  const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
  const editorHeight = element.getBoundingClientRect().height

  if (expanded.value) {
    composerHeight.value = `${editorHeight + 68}px`           // 正文加底排、间距、padding 与边框
    return
  }

  expanded.value = editorHeight > lineHeight + 1
  composerHeight.value = expanded.value ? `${editorHeight + 68}px` : '64px'
}

async function handleInput() {
  expanded.value = false                                    // 先回到横排，让 textarea 按真实可用宽度排版
  await nextTick()
  window.requestAnimationFrame(observeEditorSize)            // field-sizing 完成尺寸计算后读取实际高度
}


// --- 处理编辑器键盘提交 ---
function handleKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) return         // Shift+Enter 保留换行，其他按键正常输入
  event.preventDefault()                                      // 普通 Enter 不向 textarea 插入新行
  emit('submit', message.value)                               // 只发出文本，未来由业务层决定如何发送
}

onMounted(() => {
  resizeObserver = new ResizeObserver(observeEditorSize)
  resizeObserver.observe(editor.value)
  nextTick(observeEditorSize)
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <form class="chat-composer" :class="{ 'is-expanded': expanded }" :style="{ '--composer-height': composerHeight }" aria-label="对话编辑器" @submit.prevent="emit('submit', message)">
    <!-- 单行时三部分横排；出现第二行后，输入区独占上排，控件进入底排。 -->
    <m3e-icon-button class="chat-composer__icon-button" type="button" shape="rounded" aria-label="附件" title="附件">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12"></path></svg>
    </m3e-icon-button>

    <div class="chat-composer__viewport">
      <textarea ref="editor" v-model="message" class="chat-composer__editor" aria-label="消息" placeholder="问 Agent" rows="1" @input="handleInput" @keydown="handleKeydown"></textarea>
    </div>

    <div class="chat-composer__actions">
      <m3e-button class="chat-composer__model" shape="rounded" aria-label="模型选择">
        <m3e-menu-trigger for="chat-composer-models">
          <span>kimi-k2.6</span>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"></path></svg>
        </m3e-menu-trigger>
      </m3e-button>

      <m3e-menu id="chat-composer-models" class="chat-composer__menu" placement="top-end">
        <m3e-menu-item>kimi-k2.6</m3e-menu-item>
        <m3e-menu-item>glm-5.2</m3e-menu-item>
        <m3e-menu-item>claude-sonnet-4.5</m3e-menu-item>
      </m3e-menu>

      <m3e-icon-button class="chat-composer__submit" type="submit" variant="filled" shape="rounded" aria-label="提交" title="提交">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11 12 5M12 5l6 6M12 5v14"></path></svg>
      </m3e-icon-button>
    </div>
  </form>
</template>

<style scoped lang="scss">
/* --- 单行横排，多行通过 Flex 换行切成正文和工具栏两层 --- */
.chat-composer {
  --control-size: 40px;
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: 4px;
  width: 100%;
  height: var(--composer-height);
  min-height: 64px;
  margin: 0;
  padding: 11px;
  overflow: hidden;
  border: 1px solid #303030;
  border-radius: 32px;
  background: rgb(28 28 28 / 82%);
  box-shadow: 0 2px 10px rgb(0 0 0 / 20%);
  backdrop-filter: blur(20px);
  transition: height var(--motion-duration-spring) var(--motion-spring-bouncy), border-color 100ms ease, background-color 100ms ease;
}

.chat-composer:focus-within {
  border-color: #464646;
  background: rgb(31 31 31 / 90%);
}

.chat-composer__viewport {
  display: flex;
  align-items: center;
  align-self: stretch;
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
}

.chat-composer.is-expanded {
  flex-wrap: wrap;
  align-content: flex-end;
  row-gap: 4px;
}

.chat-composer.is-expanded .chat-composer__viewport {
  order: -1;
  flex: 1 0 100%;
  align-items: flex-start;
  align-self: auto;
  height: auto;
  min-height: 0;
}

.chat-composer__editor {
  field-sizing: content;
  display: block;
  width: 100%;
  min-height: 24px;
  max-height: 400px;
  margin: 0;
  padding: 0 8px;
  overflow-y: auto;
  resize: none;
  border: 0;
  background: transparent;
  outline: none;
  color: #f2f2f2;
  font-family: inherit;
  font-size: 16px;
  font-weight: inherit;
  letter-spacing: inherit;
  line-height: 24px;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
  scrollbar-color: #555 transparent;
}

.chat-composer__editor::placeholder {
  color: #989898;
  opacity: 1;
}

.chat-composer__editor::-webkit-scrollbar { width: 8px; }
.chat-composer__editor::-webkit-scrollbar-track { background: transparent; }
.chat-composer__editor::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: #555;
  background-clip: padding-box;
}

.chat-composer__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-left: auto;
}

.chat-composer__icon-button,
.chat-composer__submit,
.chat-composer__model {
  will-change: transform;
  transform: scale(1);
  transition: transform 360ms var(--motion-spring-bouncy), filter 120ms ease;
}

.chat-composer__icon-button,
.chat-composer__submit {
  --m3e-icon-button-shape-pressed-morph: var(--md-sys-shape-corner-full);
  width: var(--control-size);
  height: var(--control-size);
  flex: 0 0 var(--control-size);
}

.chat-composer__icon-button:hover,
.chat-composer__submit:hover,
.chat-composer__model:hover {
  filter: brightness(1.08);
  transform: translateY(-1px) scale(1.03);
}

.chat-composer__icon-button:active,
.chat-composer__submit:active,
.chat-composer__model:active {
  filter: brightness(.94);
  transform: scale(.86);
  transition: transform 60ms ease-out, filter 60ms ease-out;
}

.chat-composer__icon-button svg,
.chat-composer__submit svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.8;
  stroke-linecap: square;
  stroke-linejoin: round;
}

.chat-composer__model {
  --m3e-button-shape-round: var(--md-sys-shape-corner-full);
  --m3e-button-shape-pressed-morph: var(--md-sys-shape-corner-full);
  --shape-corner: 20px;
  --m3e-text-button-label-text-color: #ededed;
  height: var(--control-size);
  font-size: 14px;
  font-weight: 600;
}

.chat-composer__model m3e-menu-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-composer__model svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: #9b9b9b;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chat-composer__menu {
  --m3e-menu-container-color: #202020;
  --m3e-menu-container-shape: 18px;
  --m3e-menu-container-min-width: 220px;
}

.chat-composer__submit {
  --m3e-filled-icon-button-container-color: #f1f1f1;
  --m3e-filled-icon-button-icon-color: #111111;
}

.chat-composer__submit svg { stroke-width: 2; }

@media (max-width: 620px) {
  .chat-composer { --control-size: 38px; padding: 12px; }
  .chat-composer__editor { font-size: 15px; }
  .chat-composer__model { font-size: 13px; }
}

@media (prefers-reduced-transparency: reduce) {
  .chat-composer { background: #1c1c1c; backdrop-filter: none; }
}
</style>
