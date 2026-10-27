<!--
模型品牌图标：模型 ID 或供应商名能匹配到品牌时画品牌图标，否则画通用模型图标。
图标只做装饰，旁边已经有模型名或按钮的 aria-label，不重复读屏。
调用示例：<ModelIcon model="glm-4.6" provider="智谱" :size="24" />
-->
<script setup>
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { modelIconSvg } from './model-icon-assets.js'

const props = defineProps({
  model: { type: String, default: '' },
  provider: { type: String, default: '' },
  size: { type: [Number, String], default: 20 },
})
const svg = computed(() => modelIconSvg(props.model, props.provider))
const dimension = computed(() => `${Number(props.size) || 20}px`)
</script>

<template>
  <span class="model-icon" :style="{ width: dimension, height: dimension }" aria-hidden="true">
    <span v-if="svg" class="model-icon__art" v-html="svg"></span>
    <AppIcon v-else name="model" :size="size" />
  </span>
</template>

<style scoped lang="scss">
.model-icon { display: inline-grid; flex: none; place-items: center; color: currentColor; }
.model-icon__art { display: block; width: 100%; height: 100%; }
.model-icon__art :deep(svg) { display: block; width: 100% !important; height: 100% !important; }
</style>
