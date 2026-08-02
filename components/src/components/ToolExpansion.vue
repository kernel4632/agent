<!--
通用工具折叠条：左侧展示图标、工具名和参数，右侧由 M3E 提供展开箭头。
整条标题区域负责展开详细信息，调用方只需提供展示数据和默认插槽。
调用示例：<ToolExpansion icon="terminal" label="正在运行" parameter="bun run build">...</ToolExpansion>。
-->
<script setup>
const props = defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true },
  parameter: { type: String, default: '' },
  open: { type: Boolean, default: false },
  muted: { type: Boolean, default: false },
  iconFilled: { type: Boolean, default: true },
})

const emit = defineEmits(['update:open'])
</script>

<template>
  <m3e-expansion-panel
    :open="props.open"
    class="tool-expansion"
    :class="{ 'is-muted': props.muted }"
    toggle-position="after"
    @opened="emit('update:open', true)"
    @closed="emit('update:open', false)"
  >
    <div slot="header" class="tool-expansion__header">
      <m3e-icon :name="props.icon" :filled="props.iconFilled ? '1' : '0'"></m3e-icon>
      <strong class="tool-expansion__label">{{ props.label }}</strong>
      <span v-if="props.parameter || $slots.parameter" class="tool-expansion__parameter">
        <slot name="parameter">{{ props.parameter }}</slot>
      </span>
    </div>
    <div class="tool-expansion__details">
      <slot></slot>
    </div>
  </m3e-expansion-panel>
</template>

<style scoped lang="scss">
.tool-expansion {
  --m3e-expansion-panel-container-color: transparent;
  --m3e-expansion-panel-elevation: none;
  --m3e-expansion-panel-open-elevation: none;
  --m3e-expansion-panel-shape: 12px;
  --m3e-expansion-panel-open-shape: 12px;
  --m3e-expansion-panel-content-padding: 0;
  --m3e-expansion-header-collapsed-height: 52px;
  --m3e-expansion-header-expanded-height: 52px;
  --m3e-expansion-header-padding-left: 12px;
  --m3e-expansion-header-padding-right: 12px;
  display: block;
  min-width: 0;
  overflow: hidden;
  border-radius: 12px;
  opacity: 1;
  transition: opacity 160ms ease, background-color 160ms ease;

  &:hover,
  &:focus-within,
  &[open] {
    background: rgba(255, 255, 255, .045);
  }

  &.is-muted {
    opacity: .42;
  }

  &.is-muted:hover,
  &.is-muted:focus-within,
  &.is-muted[open] {
    opacity: 1;
  }
}

.tool-expansion__header {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 14px;

  > m3e-icon {
    flex: 0 0 28px;
    color: #c8cbd3;
    font-size: 28px;
  }
}

.tool-expansion__label {
  flex: 0 0 auto;
  color: #d8dbe3;
  font-size: 18px;
  line-height: 24px;
}

.tool-expansion__parameter {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  color: #9498a3;
  font: 15px/24px "Cascadia Code", Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-expansion__details {
  min-width: 0;
  padding: 4px 12px 14px 54px;
}

@media (max-width: 640px) {
  .tool-expansion {
    --m3e-expansion-header-padding-left: 2px;
    --m3e-expansion-header-padding-right: 6px;
  }

  .tool-expansion__header {
    gap: 10px;

    > m3e-icon {
      flex-basis: 24px;
      font-size: 24px;
    }
  }

  .tool-expansion__label { font-size: 17px; }
  .tool-expansion__parameter { font-size: 13px; }
  .tool-expansion__details { padding-left: 36px; }
}
</style>
