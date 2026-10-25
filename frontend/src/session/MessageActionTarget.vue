<!--
消息操作层：右键或触摸长按消息时，模糊其他内容，只显示这条消息的摘要和操作按钮。
使用 KIMA Card 承载操作窗口，按钮仍走 KIMA Button。
调用示例：<MessageActionTarget :items="items" :preview="content" role-label="助手回复" @select="onMenu"><slot /></MessageActionTarget>
-->
<script setup>
import { nextTick, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { KimaCard } from '@kernel4632/kima'
import { AppIcon, Button } from '../ui/index.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  preview: { type: String, default: '' },
  roleLabel: { type: String, default: '消息' },
  label: { type: String, default: '消息操作' },
})
const emit = defineEmits(['select'])

const open = ref(false)
const card = useTemplateRef('card')
let pressTimer = null
let pressStart = null
let pressed = false

function show() {
  open.value = true
  nextTick(() => {
    const el = card.value?.$el || card.value
    el?.focus?.()
  })
}

function close() {
  open.value = false
}

function choose(value) {
  close()
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

onBeforeUnmount(cancelPress)
</script>

<template>
  <div
    class="message-action-target"
    @contextmenu.prevent="show"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="cancelPress"
    @pointercancel="cancelPress"
  >
    <slot />
    <Teleport to="body">
      <Transition name="message-actions">
        <div v-if="open" class="message-actions" role="dialog" aria-modal="true" :aria-label="label" @click.self="close" @keydown.escape="close">
          <KimaCard ref="card" class="message-actions__card" variant="elevated" tabindex="-1">
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
              <Button variant="ghost" class="message-actions__item message-actions__cancel" @click="close">取消</Button>
            </div>
          </KimaCard>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.message-action-target { display: block; width: 100%; min-width: 0; }
.message-actions {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--la-bg) 38%, transparent);
  backdrop-filter: blur(10px);
}
.message-actions__card {
  width: min(420px, 100%);
  gap: 14px;
  padding: 20px;
  border-radius: 24px;
  outline: none;
}
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
.message-actions__cancel { color: var(--la-muted); }
.message-actions-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard); }
.message-actions-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard); }
.message-actions-enter-active .message-actions__card { transition: transform var(--la-motion-enter) var(--kima-curve-emphasized), opacity var(--la-motion-enter) var(--kima-curve-standard); }
.message-actions-leave-active .message-actions__card { transition: transform var(--la-motion-exit) var(--kima-curve-standard), opacity var(--la-motion-exit) var(--kima-curve-standard); }
.message-actions-enter-from, .message-actions-leave-to { opacity: 0; }
.message-actions-enter-from .message-actions__card, .message-actions-leave-to .message-actions__card { opacity: 0; transform: translateY(var(--la-motion-rise)) scale(.97); }
@media (max-width: 767px) {
  .message-actions { align-items: end; padding: 16px; }
  .message-actions__card { width: 100%; border-radius: 24px 24px 20px 20px; }
}
</style>
