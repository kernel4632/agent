<!--
输入框里的模式按钮：显示当前模式，点击打开独立的模式底部抽屉。
它不再自己弹菜单；模式切换频繁，所以入口一直显示在模型按钮旁边。
调用示例：<ModeButton :mode="modeLabel" :open="modeOpen" @open="modeOpen = true" />
-->
<script setup>
import { computed } from 'vue'
import { AppIcon } from '../ui/index.js'

const props = defineProps({
  mode: { type: String, default: '' },
  open: Boolean,
})
const emit = defineEmits(['open'])

const shortLabel = computed(() => (props.mode || '模式').replace(/模式$/, '') || '模式')
</script>

<template>
  <button
    type="button"
    class="composer-mode"
    :class="{ 'is-open': open }"
    :aria-label="`切换模式（当前 ${mode || '模式'}）`"
    :title="`切换模式（当前 ${mode || '模式'}）`"
    @click="emit('open')"
  >
    <AppIcon name="mode" :size="18" />
    <span class="composer-mode__label">{{ mode || '模式' }}</span>
    <span class="composer-mode__short" aria-hidden="true">{{ shortLabel }}</span>
  </button>
</template>

<style scoped lang="scss">
.composer-mode {
  display: inline-flex;
  width: auto;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--la-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.composer-mode:hover { background: var(--la-hover); }
.composer-mode.is-open { background: var(--la-accent-soft); color: var(--la-accent); }
.composer-mode__label { min-width: 0; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer-mode__short { display: none; }
@media (max-width: 767px) {
  .composer-mode { min-height: 44px; }
}
@media (max-width: 360px) {
  .composer-mode__label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .composer-mode__short { display: inline; max-width: 32px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .composer-mode { gap: 4px; padding: 0 6px; }
}
</style>
