<!--
  历史轮次内部的大块内容：靠近视口才挂载，离屏用估算高度的占位撑住布局。
  只服务已经完成的历史消息；流式中的最新轮次由 live=true 强制完整挂载。
-->
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  estimatedHeight: { type: Number, default: 100 },
  eager: Boolean,
  root: { type: Object, default: null },
})
const host = ref(null)
const mounted = ref(props.eager)
let observer = null

function observe() {
  if (mounted.value || !host.value) return
  const root = props.root || host.value.closest('.session-scroll')
  if (!root || typeof IntersectionObserver === 'undefined') {
    mounted.value = true
    return
  }
  observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    mounted.value = true
    observer?.disconnect()
    observer = null
  }, { root, rootMargin: '1200px 0px' })
  observer.observe(host.value)
}

watch(() => props.eager, value => {
  if (!value) return
  mounted.value = true
  observer?.disconnect()
  observer = null
})

onMounted(observe)
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="host" class="lazy-block">
    <slot v-if="mounted" />
    <div v-else class="lazy-block__placeholder" :style="{ height: `${Math.max(24, estimatedHeight)}px` }" aria-hidden="true"></div>
  </div>
</template>

<style scoped lang="scss" src="../styles/ui/LazyBlock.scss"></style>

