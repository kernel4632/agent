<!--
通用弹窗：用原生 dialog 的 showModal 管理打开状态，标题、表单和按钮全部由默认插槽传入。
open 由父组件控制；按 Esc 时只发出 update:open，父组件确认后才真正关闭。
调用示例：
<Dialog :open="open" label="重命名会话" @update:open="open = $event">
  <form @submit.prevent="save">...</form>
</Dialog>
-->
<script setup>
import { onMounted, ref, watch } from 'vue'

const props = defineProps({
  open: Boolean,                                       // 是否显示弹窗
  label: { type: String, default: '' },                // 弹窗的 aria-label
})

const emit = defineEmits(['update:open'])
const dialog = ref(null)

// 把外部状态同步到原生 dialog；已经处于目标状态时不重复调用。
function sync(open) {
  const element = dialog.value
  if (!element) return
  if (open && !element.open) element.showModal()
  else if (!open && element.open) element.close()
}

// Esc 交给父组件决定是否关闭，繁忙时可以忽略这次请求。
function cancel(event) {
  event.preventDefault()
  emit('update:open', false)
}

onMounted(() => sync(props.open))
watch(() => props.open, sync, { flush: 'post' })
</script>

<template>
  <dialog ref="dialog" class="dialog" :aria-label="label || undefined" @cancel="cancel">
    <slot />
  </dialog>
</template>
