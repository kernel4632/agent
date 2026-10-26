<!--
输入框里的模式菜单：显示当前模式，点开后直接选执行/计划或自定义模式。
触发器是紧凑的图标加文字；菜单内容、键盘和定位仍由 KIMA Menu 负责。
调用示例：<ModeMenu :modes="modeItems" :model-value="session.settings.mode" @select="Session.setMode(session.id, $event)" />
-->
<script setup>
import { computed } from 'vue'
import { KimaMenu } from '@kernel4632/kima'
import { AppIcon } from '../ui/index.js'

const props = defineProps({
  modes: { type: Array, default: () => [] },
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['select'])

const current = computed(() => props.modes.find(item => item.value === props.modelValue) || null)
const shortLabel = computed(() => (current.value?.label || '模式').replace(/模式$/, '') || '模式')
</script>

<template>
  <KimaMenu
    class="composer-mode"
    :items="modes"
    :model-value="modelValue"
    label="切换模式"
    placement="top-start"
    @select="emit('select', $event)"
  >
    <template #trigger>
      <span class="sr-only">切换模式：</span>
      <AppIcon name="mode" :size="18" />
      <span class="composer-mode__label" :title="current?.label || '模式'">{{ current?.label || '模式' }}</span>
      <span class="composer-mode__short" aria-hidden="true">{{ shortLabel }}</span>
    </template>
  </KimaMenu>
</template>

<style scoped lang="scss">
.composer-mode { width: auto; min-width: 0; }
/* KIMA Menu 的触发器默认是整行 56px；这里收成和模型按钮同一档的胶囊。 */
.composer-mode :deep(.kima-menu__trigger) {
  width: auto;
  min-height: 40px;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--la-text);
  font-size: 13px;
  font-weight: 500;
}
.composer-mode :deep(.kima-menu__trigger:hover) { background: var(--la-hover); }
/* KIMA 0.7.1 会给触发器补下拉箭头；图标和文字在一起时箭头多余。KIMA issue #4 修复后删除。 */
.composer-mode :deep(.kima-menu__trigger > svg:last-child) { display: none; }
.composer-mode__label { min-width: 0; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer-mode__short { display: none; }
@media (max-width: 767px) {
  .composer-mode :deep(.kima-menu__trigger) { min-height: 44px; }
}
@media (max-width: 360px) {
  /* 只把完整名字视觉隐藏，保留屏幕阅读器能读到的当前模式名；视觉上显示“执行/计划”。 */
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
  .composer-mode :deep(.kima-menu__trigger) { width: auto; gap: 4px; padding: 0 6px; }
}
</style>
