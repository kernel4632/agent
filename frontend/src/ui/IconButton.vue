<!--
通用图标按钮：统一标题栏等位置的尺寸、悬停、按下、选中和禁用状态。
调用示例：<IconButton label="设置" title="设置" @click="openSettings"><AppIcon name="settings" /></IconButton>
-->
<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  label: { type: String, required: true },              // 屏幕阅读器读到的按钮名称
  title: { type: String, default: '' },                 // 鼠标悬停时的提示文字
  size: { type: String, default: 'normal' },            // normal 28px，small 24px
  active: Boolean,                                      // 切换类按钮当前是否选中
  disabled: Boolean,
  type: { type: String, default: 'button' },
})

const emit = defineEmits(['click'])
</script>

<template>
  <button
    v-bind="$attrs"
    class="ui-icon-button"
    :class="{ 'is-active': active, 'ui-icon-button--small': size === 'small' }"
    :type="type"
    :aria-label="label"
    :title="title || undefined"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped lang="scss">
.ui-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  padding: 0;
  border: 0;
  border-radius: var(--la-radius);
  background: transparent;
  color: var(--la-secondary);
  cursor: pointer;
}
.ui-icon-button:hover:not(:disabled) { background: var(--la-hover); color: var(--la-text); }
.ui-icon-button:active:not(:disabled) { background: var(--la-pressed); color: var(--la-text); }
.ui-icon-button.is-active { background: var(--la-layer-02); color: var(--la-text); }
.ui-icon-button:focus-visible { outline: 2px solid var(--la-accent-border); outline-offset: 1px; }
.ui-icon-button:disabled { opacity: .5; cursor: not-allowed; }
.ui-icon-button--small { width: 24px; height: 24px; flex-basis: 24px; }
@media (max-width: 767px) {
  .ui-icon-button { width: 32px; height: 32px; flex-basis: 32px; }
  .ui-icon-button--small { width: 24px; height: 24px; flex-basis: 24px; }
}
</style>
