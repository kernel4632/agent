<!--
所有图标的唯一入口：包一层 Hugeicons，按尺寸自动算线宽（做法沿用旧前端 ui/Icon.vue）。
线宽用屏幕像素计（non-scaling-stroke），不随图标缩放：小图标线条不至于细到发虚，大图标也不会粗笨。
两个锚点之间线性过渡、两端封顶：14px → 1.3px（旧前端底栏的细度），20px → 1.5px（grok.com 发送箭头实测）。
调用示例：<Icon :icon="Clock01Icon" :size="14" />
-->
<script setup lang="ts">
import { computed } from 'vue'
import { HugeiconsIcon } from '@hugeicons/vue'

const props = withDefaults(defineProps<{ icon: any; size?: number }>(), { size: 16 })
const stroke = computed(() => {
  const progress = Math.min(1, Math.max(0, (props.size - 14) / (20 - 14)))
  return Number((1.3 + (1.5 - 1.3) * progress).toFixed(2))
})
</script>

<template>
  <HugeiconsIcon class="icon" :icon="icon" :size="size" :stroke-width="stroke" aria-hidden="true" />
</template>

<style scoped>
.icon { display: inline-block; flex: none; vertical-align: middle; pointer-events: none; }
.icon :deep(*) { vector-effect: non-scaling-stroke; }
</style>
