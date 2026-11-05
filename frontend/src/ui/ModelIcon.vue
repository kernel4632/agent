<!--
模型图标：优先加载服务端解析出的 models.dev logo；没有 family 时由服务端按 modelId 自动判断。
加载失败统一回退通用模型图标，不显示空白或错误品牌。
调用示例：<ModelIcon :model="model.id" :family="model.family" :size="20" />
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { AgentAPI } from '../utils/api.js'

const props = defineProps({
  model: { type: String, default: '' },
  family: { type: String, default: '' },
  size: { type: [Number, String], default: 20 },
  label: { type: String, default: '' },
})
const currentTheme = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
const theme = ref(currentTheme())
let observer
onMounted(() => {
  theme.value = currentTheme()
  observer = new MutationObserver(() => { theme.value = currentTheme() })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})
onBeforeUnmount(() => observer?.disconnect())
const failed = ref(false)
const src = computed(() => props.model || props.family ? AgentAPI.modelIconUrl(props.model, props.family, theme.value) : '')
watch(src, () => { failed.value = false })
</script>

<template>
  <span class="model-icon" :style="{ width: `${size}px`, height: `${size}px` }">
    <img
      v-if="src && !failed"
      class="model-icon__image"
      :src="src"
      :alt="label || model"
      :width="size"
      :height="size"
      loading="lazy"
      decoding="async"
      @error="failed = true"
    />
    <Icon v-else name="model" :size="size" />
  </span>
</template>

<style scoped lang="scss" src="../styles/ui/ModelIcon.scss"></style>
