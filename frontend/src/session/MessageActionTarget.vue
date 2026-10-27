<!--
消息操作层：右键、长按或键盘菜单键打开，只显示这条消息的摘要和操作按钮。
外壳用 ui/Dialog，焦点陷阱、Esc 和关闭后的焦点归还都由 KIMA 原生 dialog 处理。
调用示例：<MessageActionTarget :items="items" :preview="content" role-label="助手回复" @select="onMenu"><slot /></MessageActionTarget>
-->
<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { AppIcon, Button, Dialog } from '../ui/index.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  preview: { type: String, default: '' },
  roleLabel: { type: String, default: '消息' },
  label: { type: String, default: '消息操作' },
})
const emit = defineEmits(['select'])

const open = ref(false)
let pressTimer = null
let pressStart = null
let pressed = false

function show() {
  if (!props.items.length) return
  open.value = true
}

function choose(value) {
  open.value = false
  emit('select', value)
}

function cancelPress() {
  if (pressTimer) window.clearTimeout(pressTimer)
  pressTimer = null
  pressed = false
  pressStart = null
}

function onPointerDown(event) {
  if (event.pointerType === 'mouse') return                    // 鼠标用右键 contextmenu，不走长按
  pressed = true                                                // 标记手指还按在消息上
  pressStart = { x: event.clientX, y: event.clientY }           // 记住起点，用来判断是不是在滚动
  pressTimer = window.setTimeout(() => {                        // 480ms 比系统长按略长，避免滑动时误开操作层
    if (pressed) show()                                         // 手指没松开才打开
    cancelPress()
  }, 480)
}

function onPointerMove(event) {
  if (!pressed || !pressStart) return
  // 移动超过 8px 当作用户在滚动或选字，取消长按，不打断原操作。
  if (Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 8) cancelPress()
}

function onKeydown(event) {
  // Shift+F10 和菜单键是键盘用户打开右键菜单的通用方式。
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault()
    show()
  }
}

onBeforeUnmount(cancelPress)
</script>

<template>
  <div
    class="message-action-target"
    tabindex="0"
    @contextmenu.prevent="show"
    @keydown="onKeydown"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="cancelPress"
    @pointercancel="cancelPress"
  >
    <slot />
  </div>

  <Dialog :open="open" :label="label" @update:open="open = $event">
    <Transition name="message-actions" appear>
      <div v-if="open" class="message-actions message-actions__card">
        <div class="message-actions__role">{{ roleLabel }}</div>
        <p class="message-actions__preview">{{ preview || '这条消息没有可复制的文字' }}</p>
        <div class="message-actions__items">
          <Button
            v-for="item in items"
            :key="item.value"
            variant="ghost"
            class="message-actions__item"
            :disabled="item.disabled"
            @click="choose(item.value)"
          >
            <AppIcon :name="item.icon || 'spark'" :size="18" /><span>{{ item.label }}</span>
          </Button>
        </div>
      </div>
    </Transition>
  </Dialog>
</template>

<style scoped lang="scss">
.message-action-target { display: block; width: 100%; min-width: 0; }
.message-action-target:focus-visible { outline: 2px solid var(--kima-color-primary); outline-offset: 3px; border-radius: 8px; }
.message-actions { display: grid; gap: 14px; }
.message-actions-enter-active, .message-actions-leave-active { transition: opacity 220ms var(--kima-curve-standard), transform 220ms var(--kima-curve-emphasized); }
.message-actions-enter-from, .message-actions-leave-to { opacity: 0; transform: translateY(8px) scale(.98); }
@media (prefers-reduced-motion: reduce) { .message-actions-enter-active, .message-actions-leave-active { transition-duration: 1ms; } }
.message-actions__role { color: var(--la-muted); font-size: 13px; font-weight: 600; line-height: 18px; }
.message-actions__preview {
  display: -webkit-box;
  max-height: 132px;
  margin: 0;
  overflow: hidden;
  color: var(--la-text);
  font-size: 15px;
  line-height: 22px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.message-actions__items { display: flex; flex-direction: column; gap: 2px; }
.message-actions__item { width: 100%; justify-content: flex-start; gap: 10px; }
</style>
