<!-- 全局提示条：四秒后关闭，新消息重新计时。示例：<Toast :message="toast" @close="toast = ''" /> -->
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
const props = defineProps({ message: { type: String, default: '' } })
const emit = defineEmits(['close'])
const shown = ref(props.message)
let timer
watch(() => props.message, value => {
  clearTimeout(timer)
  if (!value) return
  shown.value = value
  timer = setTimeout(() => emit('close'), 4000)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template><Teleport to="body"><Transition name="toast"><div v-if="message" class="app-toast" role="status"><span>{{ shown }}</span><Button icon label="关闭提示" variant="text" @click="emit('close')"><Icon name="close" :size="18" /></Button></div></Transition></Teleport></template>
<style scoped lang="scss" src="../../styles/components/feedback/Toast.scss"></style>
