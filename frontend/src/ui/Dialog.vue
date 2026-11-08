<!-- 弹层：原生 dialog 负责焦点圈定与恢复，placement 决定居中或抽屉。示例：<Dialog v-model:open="open" label="编辑">内容</Dialog> -->
<script setup>
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import Button from './Button.vue'
import Icon from './Icon.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps({ open: Boolean, label: String, description: String, placement: { type: String, default: 'center' }, width: [Number, String], plain: Boolean })
const emit = defineEmits(['update:open'])
const dialog = ref(null)
const closing = ref(false)
const id = useId()
let timer
let pointerOnBackdrop = false
watch(() => props.open, async open => {
  clearTimeout(timer) // 快速重开时取消上一次退场
  await nextTick()
  if (!dialog.value || open !== props.open) return
  if (open) {
    closing.value = false
    if (!dialog.value.open) dialog.value.showModal()
    return
  }
  closing.value = true
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.hasAttribute('data-reduced-motion')
  timer = setTimeout(() => dialog.value?.close(), reduced ? 0 : 160)
}, { immediate: true })
onBeforeUnmount(() => { clearTimeout(timer); dialog.value?.close() })
function dismiss() { emit('update:open', false) }

// 浏览器默认允许 Tab 进入地址栏；在模态内容首尾循环，保留原有键盘行为。
function keepFocus(event) {
  if (event.key !== 'Tab') return
  const controls = [...dialog.value.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
    .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length)
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" v-bind="$attrs" class="ui-dialog" :class="[`ui-dialog--${placement}`, { 'is-closing': closing, 'app-sheet': placement === 'bottom', 'ui-dialog--plain': plain }]" :style="width ? { '--app-sheet-width': `${width}px` } : undefined" :aria-label="label || $attrs['aria-label']" :aria-describedby="description ? `${id}-description` : undefined" @cancel.prevent="dismiss" @keydown="keepFocus" @pointerdown="pointerOnBackdrop = $event.target === dialog" @click="pointerOnBackdrop && $event.target === dialog && dismiss()">
      <section class="ui-dialog__panel">
        <header v-if="!plain" class="ui-dialog__header">
          <div class="ui-dialog__heading"><slot name="header"><h2 v-if="label">{{ label }}</h2></slot><p v-if="description" :id="`${id}-description`">{{ description }}</p></div>
          <Button icon label="关闭" variant="text" @click="dismiss"><Icon name="close" :size="20" /></Button>
        </header>
        <div class="ui-dialog__body"><slot /></div>
        <footer v-if="$slots.footer" class="ui-dialog__footer"><slot name="footer" /></footer>
      </section>
    </dialog>
  </Teleport>
</template>
<style scoped lang="scss" src="../styles/ui/Dialog.scss"></style>
