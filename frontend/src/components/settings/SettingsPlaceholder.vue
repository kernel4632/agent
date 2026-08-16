<!--
设置占位组件：尚未实现的设置分类使用此组件保持页面层级稳定。
设计思想是维持布局一致性，待正式组件完成后直接替换，不影响其他分类。
调用示例：<SettingsPlaceholder title="工具管理" description="管理 Agent 可调用的工具。" icon="build" />。
-->
<script setup>
import { HugeiconsIcon } from '@hugeicons/vue'
import { ICON_STROKE_WIDTH } from '../../theme.js'

const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, required: true },
  icon: { type: Object, required: true },
})
</script>

<template>
  <section class="settings-placeholder">
    <HugeiconsIcon :icon="props.icon" :stroke-width="ICON_STROKE_WIDTH" />
    <m3e-heading variant="headline" size="small" level="2">{{ props.title }}</m3e-heading>
    <p>{{ props.description }}</p>
  </section>
</template>

<style scoped lang="scss">
.settings-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 420px;
  gap: 14px;
  padding: 32px;
  color: var(--md-sys-color-outline);
  text-align: center;

  > m3e-icon {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 40px;
  }

  p {
    max-width: 460px;
    margin: 0;
    line-height: 1.7;
  }
}
</style>
