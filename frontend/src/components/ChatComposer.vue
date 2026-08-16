<!--
对话编辑器：封装输入、附件、模型选择和提交意图，不包含具体业务逻辑。
调用方通过 props 提供文案与模型，通过事件接收用户操作。
调用示例：<ChatComposer :models="models" @submit="sendMessage" />。
-->
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue' // 管理草稿与原生尺寸观察
import { HugeiconsIcon } from '@hugeicons/vue'
import { PlusSignIcon, ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'
import { ICON_STROKE_WIDTH } from '../theme.js'

const props = defineProps({                                   // 由调用方提供可复用的展示数据
  placeholder: { type: String, default: '问 Agent' },
  selectedModel: { type: String, default: 'kimi-k2.6' },
  models: { type: Array, default: () => ['kimi-k2.6', 'glm-5.2', '[REDACTED].5'] },
})
const emit = defineEmits(['attach', 'select-model', 'submit']) // 将业务意图交给组件外部处理
const draft = defineModel('draft', { type: String, default: '' }) // 草稿文本由 store 持有，切换会话保留输入

const composer = ref(null)                                    // 外框提供实际 padding 与边框尺寸
const editor = ref(null)                                      // textarea 提供浏览器计算后的内容高度
const actions = ref(null)                                     // 底排提供实际控件高度
const expanded = ref(false)                                   // 第二行出现后切换为上下结构
const composerHeight = ref('64px')                            // 根据实际布局尺寸驱动外框过渡
const modelMenuID = `chat-composer-models-${useId()}`         // 避免多个组件实例共享菜单 ID
let editorResizeObserver                                      // 卸载时停止尺寸观察
let layoutFrame                                               // 新输入会取消上一帧过期测量


// --- 根据浏览器计算出的真实尺寸更新布局 ---
function observeEditorSize() {
  const element = editor.value
  const shell = composer.value
  const toolbar = actions.value
  if (!element || !shell || !toolbar) return                  // 节点未挂载时没有可用尺寸

  const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
  const editorHeight = element.getBoundingClientRect().height
  const shellStyle = getComputedStyle(shell)                  // 读取 CSS 中真实的间距，不在脚本重复魔数
  const blockPadding = Number.parseFloat(shellStyle.paddingTop) + Number.parseFloat(shellStyle.paddingBottom)
  const blockBorder = Number.parseFloat(shellStyle.borderTopWidth) + Number.parseFloat(shellStyle.borderBottomWidth)
  const rowGap = Number.parseFloat(shellStyle.rowGap) || 0
  const toolbarHeight = toolbar.getBoundingClientRect().height
  const expandedHeight = editorHeight + toolbarHeight + blockPadding + blockBorder + rowGap

  if (expanded.value) {
    composerHeight.value = `${expandedHeight}px`
    return
  }

  expanded.value = editorHeight > lineHeight + 1
  composerHeight.value = expanded.value ? `${expandedHeight}px` : '64px'
}

// --- 输入后重新测量编辑器布局 ---
async function measureLayout() {
  expanded.value = false                                      // 先回到横排，让 textarea 按真实可用宽度排版
  await nextTick()
  window.cancelAnimationFrame(layoutFrame)                    // 快速输入时只保留最后一次布局请求
  layoutFrame = window.requestAnimationFrame(observeEditorSize) // field-sizing 完成后读取实际高度
}


// --- 回车键提交消息 ---
function submitOnEnter(event) {
  if (event.key !== 'Enter' || event.shiftKey) return         // Shift+Enter 保留换行，其他按键正常输入
  event.preventDefault()                                      // 普通 Enter 不向 textarea 插入新行
  submitForm()                                                // 共用提交逻辑
}


// --- 表单提交（按钮或 Enter） ---
function submitForm() {
  if (!draft.value.trim()) return                             // 空文本不触发发送
  emit('submit', draft.value)                                 // 只发出文本，未来由业务层决定如何发送
  draft.value = ''                                            // 发送后立即清空草稿
}

onMounted(() => {
  editorResizeObserver = new ResizeObserver(observeEditorSize) // 内容、字体或宽度变化都会更新高度
  editorResizeObserver.observe(editor.value)
  nextTick(observeEditorSize)
})

onBeforeUnmount(() => {
  editorResizeObserver?.disconnect()                          // 停止浏览器尺寸回调
  window.cancelAnimationFrame(layoutFrame)                    // 丢弃尚未执行的布局请求
})
</script>

<template>
  <form ref="composer" class="chat-composer" :class="{ 'is-expanded': expanded }" :style="{ '--composer-height': composerHeight }" aria-label="对话编辑器" @submit.prevent="submitForm">
    <!-- 单行时三部分横排；出现第二行后，输入区独占上排，控件进入底排。 -->
    <m3e-icon-button class="chat-composer__icon-button" type="button" shape="rounded" aria-label="附件" title="附件" @click="emit('attach')">
      <HugeiconsIcon :icon="PlusSignIcon" :stroke-width="ICON_STROKE_WIDTH" />
    </m3e-icon-button>

    <div class="chat-composer__viewport">
      <textarea ref="editor" v-model="draft" class="chat-composer__editor" aria-label="消息" :placeholder="props.placeholder" rows="1" @input="measureLayout" @keydown="submitOnEnter"></textarea>
    </div>

    <div ref="actions" class="chat-composer__actions">
      <m3e-button class="chat-composer__model" type="button" shape="rounded" aria-label="模型选择">
        <m3e-menu-trigger :for="modelMenuID">
          <span>{{ props.selectedModel }}</span>
          <HugeiconsIcon :icon="ArrowDown01Icon" :stroke-width="ICON_STROKE_WIDTH" />
        </m3e-menu-trigger>
      </m3e-button>

      <m3e-menu :id="modelMenuID" class="chat-composer__menu" placement="top-end">
        <m3e-menu-item v-for="model in props.models" :key="model" @click="emit('select-model', model)">{{ model }}</m3e-menu-item>
      </m3e-menu>

      <m3e-icon-button class="chat-composer__submit" type="submit" variant="filled" shape="rounded" aria-label="提交" title="提交">
        <HugeiconsIcon :icon="ArrowUp01Icon" :stroke-width="ICON_STROKE_WIDTH" />
      </m3e-icon-button>
    </div>
  </form>
</template>

<style scoped lang="scss">

/* --- 编辑器外框：单行横排，多行时 Flex 换行切成正文和工具栏两层 --- */
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
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 32px;                                                /* 全圆角形成胶囊外观 */
  background: var(--md-sys-color-surface-container-high);
  backdrop-filter: blur(20px);                                        /* 毛玻璃背景融合底层内容 */
  transition: height var(--motion-duration-spring) var(--motion-spring-bouncy), border-color 100ms ease, background-color 100ms ease;
}

/* --- 聚焦态：加亮边框和背景 --- */
.chat-composer:focus-within {
  border-color: var(--md-sys-color-outline);
  background: var(--md-sys-color-surface-container-highest);
}

/* --- 文本视口：承载自适应高度 textarea --- */
.chat-composer__viewport {
  display: flex;
  align-items: center;
  align-self: stretch;
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
}

/* --- 展开态：输入区独占上排，按钮进入底排 --- */
.chat-composer.is-expanded {
  flex-wrap: wrap;
  align-content: flex-end;
  row-gap: 4px;
}

.chat-composer.is-expanded .chat-composer__viewport {
  order: -1;                                                          /* 输入区排在最前 */
  flex: 1 0 100%;                                                     /* 独占整行宽度 */
  align-items: flex-start;
  align-self: auto;
  height: auto;
  min-height: 0;
}

/* --- 文本编辑器：field-sizing 自适应内容高度 --- */
.chat-composer__editor {
  field-sizing: content;                                              /* 浏览器原生内容驱动高度 */
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
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: 16px;
  font-weight: inherit;
  letter-spacing: inherit;
  line-height: 24px;
  overflow-wrap: anywhere;
  @include scrollbar-dark;
}

.chat-composer__editor::placeholder {
  color: var(--md-sys-color-outline);
  opacity: 1;
}

/* --- 底排操作区：模型选择和提交按钮 --- */
.chat-composer__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-left: auto;
}

/* --- 控件交互：按压缩小，悬停交给 M3E state-layer --- */
.chat-composer__icon-button,
.chat-composer__submit,
.chat-composer__model {
  @include bounce-interact;
  transition-duration: 360ms;                                         /* 编辑器控件使用更快的弹簧时长 */
  &:active { transform: scale(.86); transition: transform 60ms ease-out, filter 60ms ease-out; } /* 按压幅度比全局更夸张 */
}

.chat-composer__icon-button,
.chat-composer__submit {
  --m3e-icon-button-shape-pressed-morph: var(--md-sys-shape-corner-full);
  width: var(--control-size);
  height: var(--control-size);
  flex: 0 0 var(--control-size);
}

/* --- 图标按钮 SVG 描边 --- */
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

/* --- 模型选择按钮：胶囊文本按钮 --- */
.chat-composer__model {
  --m3e-button-shape-round: var(--md-sys-shape-corner-full);
  --m3e-button-shape-pressed-morph: var(--md-sys-shape-corner-full);
  --m3e-text-button-label-text-color: var(--md-sys-color-on-surface);
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
  stroke: var(--md-sys-color-outline);
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* --- 模型浮层菜单 --- */
.chat-composer__menu {
  --m3e-menu-container-color: var(--md-sys-color-surface-container);
  --m3e-menu-container-shape: 18px;
  --m3e-menu-container-min-width: 220px;
}

/* --- 提交按钮：高对比度填充 --- */
.chat-composer__submit {
  --m3e-filled-icon-button-container-color: var(--md-sys-color-primary);
  --m3e-filled-icon-button-icon-color: var(--md-sys-color-on-primary);
}

.chat-composer__submit svg { stroke-width: 2; }

/* --- 移动端适配：缩小控件和字号 --- */
@media (max-width: 620px) {
  .chat-composer { --control-size: 38px; padding: 12px; }
  .chat-composer__editor { font-size: 15px; }
  .chat-composer__model { font-size: 13px; }
}

/* --- 关闭透明度的无障碍适配 --- */
@media (prefers-reduced-transparency: reduce) {
  .chat-composer {   background: var(--md-sys-color-surface-container-low); backdrop-filter: none; }
}
</style>
