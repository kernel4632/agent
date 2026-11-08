<!--
通用折叠容器：关闭时卸载内容，展开/收起用真实高度做动画。
比 v-if 多一段高度过渡，比常驻 DOM 少一大块离屏内容；调用示例：
<Fold :open="open"><div>...</div></Fold>
-->
<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({ open: Boolean, instant: Boolean, slow: Boolean, appear: Boolean })
const rootEl = ref(null)
let safetyTimer = 0

// 动画结束后如果高度还是 0（父级动画/中断导致），再兜底放开一次，绝不留空白。
watch(() => props.open, open => {
  clearTimeout(safetyTimer)
  if (!open) return
  safetyTimer = window.setTimeout(() => {
    const element = rootEl.value
    if (!element || !props.open) return
    if (element.getBoundingClientRect().height === 0) {
      element.style.height = 'auto'
      element.style.opacity = '1'
    }
  }, 260)
})

// 从 0 到内容真实高度，动画结束再交回 auto，后续流式内容可以继续长高。
function enter(element) {
  if (props.instant) {
    element.style.height = 'auto'
    element.style.opacity = '1'
    return
  }
  element.style.height = '0px'
  element.style.opacity = '0'
  void element.offsetHeight
  // 父级折叠正在展开时，子内容可能暂时量到 0；这时直接放开 auto，避免卡成空白。
  const height = element.scrollHeight
  if (!height) {
    element.style.height = 'auto'
    element.style.opacity = '1'
    return
  }
  element.style.height = `${height}px`
  element.style.opacity = '1'
}
function afterEnter(element) {
  element.style.height = 'auto'
  element.style.opacity = ''
}
function leave(element) {
  if (props.instant) {
    element.style.height = '0px'
    element.style.opacity = '0'
    return
  }
  element.style.height = `${element.scrollHeight}px`
  element.style.opacity = '1'
  void element.offsetHeight
  element.style.height = '0px'
  element.style.opacity = '0'
}
function afterLeave(element) {
  element.style.height = ''
  element.style.opacity = ''
}
onBeforeUnmount(() => clearTimeout(safetyTimer))
</script>

<template>
  <Transition name="fold" :appear="appear" @enter="enter" @after-enter="afterEnter" @leave="leave" @after-leave="afterLeave">
    <div v-if="open" ref="rootEl" class="fold" :class="{ 'is-instant': instant, 'is-slow': slow }">
      <div class="fold__inner"><slot /></div>
    </div>
  </Transition>
</template>

<style scoped lang="scss" src="../styles/ui/Fold.scss"></style>
