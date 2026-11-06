<!--
服务状态提示：对比进程启动版本和仓库目标版本。
有未生效代码时只提示“需要重启”，不提供、也不调用任何杀进程/重启进程的接口。
调用示例：<RestartNotice />（放在 TopBar 下方）。
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '../../ui/Button.vue'
import Icon from '../../ui/Icon.vue'
import { AgentAPI } from '../../utils/api.js'

const health = ref(null)
const error = ref('')
const checking = ref(false)
let timer = 0

const needsRestart = computed(() => Boolean(
  health.value?.restartRequired
  && health.value?.version
  && health.value?.targetVersion
  && health.value.version !== health.value.targetVersion,
))
const unavailable = computed(() => Boolean(error.value) && !health.value)

async function check() {
  if (checking.value) return
  checking.value = true
  try {
    health.value = await AgentAPI.getHealth()
    error.value = ''
  } catch (err) {
    health.value = null
    error.value = err.message
  } finally {
    checking.value = false
  }
}

function onVisibility() {
  if (document.visibilityState === 'visible') void check()
}

onMounted(() => {
  void check()
  timer = window.setInterval(check, 15000)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  window.clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <Transition name="restart-notice">
    <div v-if="needsRestart || unavailable" class="restart-notice" :class="{ 'is-error': unavailable }" role="status" aria-live="polite">
      <span class="restart-notice__icon" aria-hidden="true"><Icon :name="unavailable ? 'info' : 'refresh'" :size="16" /></span>
      <span class="restart-notice__copy">
        <strong>{{ needsRestart ? '需要重启后端' : '无法读取服务状态' }}</strong>
        <span v-if="needsRestart">运行版本 {{ health.version }}，代码版本 {{ health.targetVersion }}。请重启后端服务以加载新代码，重启后此提示会自动消失。</span>
        <span v-else>连接断开，暂时无法确认新代码是否已生效。</span>
      </span>
      <Button variant="ghost" size="small" :disabled="checking" @click="check">{{ checking ? '检查中…' : '重新检查' }}</Button>
    </div>
  </Transition>
</template>

<style scoped lang="scss" src="../../styles/components/feedback/RestartNotice.scss"></style>
