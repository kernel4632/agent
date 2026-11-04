<!-- 全局提示条：纯文本四秒后关闭，带操作按钮的八秒；新消息重新计时。示例：<Toast :message="toast" @close="toast = ''" /> -->
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
const props = defineProps({ message: { type: [String, Object], default: '' } })
const emit = defineEmits(['close'])
const shown = ref('')                                  // 退出动画期间还要显示的文字
const action = ref(null)
let timer
watch(() => props.message, value => {
  clearTimeout(timer)
  if (!value) return                                   // 可见性由 message prop 决定；清空即触发退出动画
  const entry = typeof value === 'object' && value !== null ? value : { message: String(value) }
  shown.value = entry.message ?? ''
  action.value = entry.action && entry.action.label && typeof entry.action.run === 'function' ? entry.action : null
  timer = setTimeout(() => emit('close'), action.value ? 8000 : 4000)
}, { immediate: true })

// 先收起提示条再执行动作：动作里弹出的新提示不会被随后的关闭误清。
function onAction() {
  emit('close')
  Promise.resolve(action.value?.run()).catch(() => {})
}
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template><Teleport to="body"><Transition name="toast"><div v-if="message" class="app-toast" role="status"><span>{{ shown }}</span><Button v-if="action" variant="text" @click="onAction">{{ action.label }}</Button><Button icon label="关闭提示" variant="text" @click="emit('close')"><Icon name="close" :size="18" /></Button></div></Transition></Teleport></template>
<style scoped lang="scss" src="../../styles/components/feedback/Toast.scss"></style>
