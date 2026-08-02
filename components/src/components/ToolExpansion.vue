<!--
通用工具折叠条：左侧展示图标、工具名和参数，右侧提供回退按钮和展开箭头。
整条标题区域负责展开详细信息；回退按钮隔离折叠事件并向调用方发出 rollback。
调用示例：<ToolExpansion icon="terminal" label="正在运行" parameter="bun run build">...</ToolExpansion>。
-->
<script setup>
import { ref } from 'vue'                              // 保存回退按钮与确认菜单的元素引用

const props = defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true },
  parameter: { type: String, default: '' },
  open: { type: Boolean, default: false },
  muted: { type: Boolean, default: false },
  iconFilled: { type: Boolean, default: true },
  rollbackLabel: { type: String, default: '回退此工具操作' },
})

const emit = defineEmits(['update:open', 'rollback'])  // 同步展开状态，并在确认后发出回退意图
const rollbackMenu = ref(null)                        // M3E 菜单负责锚定显示和关闭确认提示
const rollbackButton = ref(null)                      // Undo 按钮是确认菜单的定位锚点

// --- 在 Undo 按钮旁显示二次确认 ---
function showRollbackConfirmation() {
  rollbackMenu.value?.show(rollbackButton.value)
}


// --- 确认后关闭提示并通知调用方 ---
function confirmRollback() {
  rollbackMenu.value?.hide()                          // 先收起浮层，立即反馈当前点击
  emit('rollback')                                    // 业务层根据工具 ID 执行真实回退
}
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
      <m3e-icon-button
        class="tool-expansion__rollback"
        ref="rollbackButton"
        type="button"
        shape="rounded"
        size="extra-small"
        :aria-label="props.rollbackLabel"
        :title="props.rollbackLabel"
        @pointerdown.stop
        @click.stop="showRollbackConfirmation"
        @keydown.stop
      >
        <m3e-icon name="undo" filled="1"></m3e-icon>
      </m3e-icon-button>
    </div>
    <div class="tool-expansion__details">
      <slot></slot>
    </div>
  </m3e-expansion-panel>
  <m3e-menu ref="rollbackMenu" class="tool-expansion__confirm-menu" position-x="before" position-y="below">
    <div class="tool-expansion__confirm-content">
      <span>确定回退吗？</span>
      <m3e-button class="tool-expansion__confirm-button" type="button" variant="filled" width="wide" @click.stop="confirmRollback">确定</m3e-button>
    </div>
  </m3e-menu>
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

.tool-expansion__rollback {
  flex: 0 0 auto;
  --m3e-icon-button-shape: var(--md-sys-shape-corner-full);
}

.tool-expansion__confirm-menu {
  --m3e-menu-container-min-width: 168px;
  --m3e-menu-container-padding-block: 0;
  --m3e-menu-container-padding-inline: 0;
}

.tool-expansion__confirm-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  color: #e5e5e5;
  font-size: 14px;

  m3e-button { width: 100%; }
}

.tool-expansion__details {
  min-width: 0;
  padding: 4px 12px 14px;
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
  .tool-expansion__details { padding: 4px 6px 12px 2px; }
}
</style>
