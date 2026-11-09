<!--
  打开完整会话时的全屏加载层：进度来自服务端流式读取的真实字节数和归一化阶段。
  调用示例：<SessionLoading />，数据从 store.ui.sessionLoading 读取。
-->
<script setup>
import { computed } from 'vue'
import { store } from '../../store.js'
import RingProgress from '../../ui/RingProgress.vue'

const loading = computed(() => store.ui.sessionLoading)
const percent = computed(() => Math.min(100, Math.max(0, Math.round(Number(loading.value?.percent) || 0))))
const phase = computed(() => {
  const value = loading.value?.phase
  if (value === 'parsing') return '正在解析消息'
  if (value === 'rendering') return '正在渲染对话'
  if (value === 'session') return '正在接收会话'
  return '正在读取完整历史'
})
const speed = computed(() => {
  const value = Number(loading.value?.speed) || 0
  if (!value) return ''
  return `${formatBytes(value)}/s`
})
const eta = computed(() => {
  const value = Number(loading.value?.eta) || 0
  return value > 0 ? `约 ${value} 秒` : ''
})
const size = computed(() => {
  const total = Number(loading.value?.totalBytes) || 0
  if (!total) return ''
  return `${formatBytes(Number(loading.value?.bytes) || 0)} / ${formatBytes(total)}`
})
function formatBytes(value) {
  const number = Math.max(0, Number(value) || 0)
  if (number >= 1024 * 1024) return `${(number / 1024 / 1024).toFixed(1)} MB`
  if (number >= 1024) return `${Math.round(number / 1024)} KB`
  return `${Math.round(number)} B`
}
</script>

<template>
  <Transition name="session-loading">
    <div v-if="loading?.active" class="session-loading" role="status" aria-live="polite" aria-label="正在打开会话">
      <div class="session-loading__card">
        <div class="session-loading__head">
          <RingProgress :value="percent" :max="100" :size="58" :stroke-width="6" label="会话加载进度" />
          <div class="session-loading__copy">
            <strong>正在打开会话</strong>
            <span>{{ phase }}</span>
          </div>
          <span class="session-loading__percent">{{ percent }}%</span>
        </div>
        <div
          class="session-loading__bar"
          :class="{ 'is-waiting': loading.phase === 'reading' && !Number(loading.totalBytes) }"
          role="progressbar"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="percent"
        >
          <span :style="{ width: `${percent}%` }"></span>
        </div>
        <div class="session-loading__meta">
          <span>{{ size }}</span>
          <span v-if="speed">读取 {{ speed }}</span>
          <span v-if="eta">剩余 {{ eta }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss" src="../../styles/components/feedback/SessionLoading.scss"></style>
