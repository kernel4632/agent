<!--
输入框里的智能体按钮：显示当前智能体，点击打开独立的智能体底部抽屉。
智能体切换频繁，所以入口一直显示在模型按钮旁边。
调用示例：<AgentButton :agent="agentLabel" :open="agentOpen" @open="agentOpen = true" />
-->
<script setup>
import { computed } from 'vue'
import { AppIcon } from '../ui/index.js'

const props = defineProps({
  agent: { type: String, default: '' },
  open: Boolean,
})
const emit = defineEmits(['open'])

const label = computed(() => props.agent || '智能体')
</script>

<template>
  <button
    type="button"
    class="composer-agent"
    :class="{ 'is-open': open }"
    :aria-label="`切换智能体（当前 ${label}）`"
    :title="`切换智能体（当前 ${label}）`"
    @click="emit('open')"
  >
    <AppIcon name="mode" :size="18" />
    <span class="composer-agent__label">{{ label }}</span>
  </button>
</template>

<style scoped lang="scss" src="../styles/composer/AgentButton.scss"></style>
