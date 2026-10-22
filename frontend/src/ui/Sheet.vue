<!--
底部弹层：对应 RikkaHub 的 ModalBottomSheet，用于模型选择、搜索和更多选项。
标题、搜索框和列表由调用方放在默认插槽；顶部拖拽条和遮罩由这里统一提供。
调用示例：<Sheet :open="open" label="选择模型" @update:open="open = $event">...</Sheet>
-->
<script setup>
import { onMounted, ref, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  label: { type: String, default: '' },
})
const emit = defineEmits(['update:open'])
const sheet = ref(null)

function sync(open) {
  const element = sheet.value
  if (!element) return
  if (open && !element.open) element.showModal()
  else if (!open && element.open) element.close()
}

function cancel(event) {
  event.preventDefault()
  emit('update:open', false)
}

onMounted(() => sync(props.open))
watch(() => props.open, sync, { flush: 'post' })
</script>

<template>
  <dialog ref="sheet" class="sheet" :aria-label="label || undefined" @cancel="cancel">
    <div class="sheet__handle" aria-hidden="true"></div>
    <slot />
  </dialog>
</template>

<style scoped lang="scss">
.sheet {
  width: min(640px, 100vw);
  max-width: 100vw;
  max-height: 80vh;
  margin: auto auto 0;
  padding: 4px 16px calc(16px + env(safe-area-inset-bottom));
  overflow-y: auto;
  border: 0;
  border-radius: 28px 28px 0 0;
  background: var(--la-panel);
  color: var(--la-text);
  box-shadow: 0 -12px 40px rgba(0, 0, 0, .18);
}
.sheet[open] { animation: sheet-in .18s cubic-bezier(.2, 0, 0, 1); }
@keyframes sheet-in { from { transform: translateY(24px); opacity: .6; } to { transform: translateY(0); opacity: 1; } }
.sheet::backdrop { background: color-mix(in srgb, #000 32%, transparent); }
.sheet__handle {
  width: 32px;
  height: 4px;
  margin: 4px auto 12px;
  border-radius: 999px;
  background: var(--la-line-strong);
}
</style>
