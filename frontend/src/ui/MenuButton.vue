<!--
图标触发的 KIMA 下拉菜单：用于列表行右侧的“更多操作”。
KIMA Menu 默认是整行选择框；这里只把触发器收成一个 40px 图标按钮，菜单内容和键盘行为仍由 KimaMenu 负责。
调用示例：
<MenuButton label="会话的更多操作" :items="[{ value: 'rename', label: '重命名' }]" @select="run" />
-->
<script setup>
import { KimaMenu } from '@kernel4632/kima'
import AppIcon from './AppIcon.vue'

defineProps({
  label: { type: String, default: '更多操作' },
  items: { type: Array, default: () => [] },
})
const emit = defineEmits(['select'])
</script>

<template>
  <KimaMenu
    class="ui-menu-button"
    :items="items"
    :label="label"
    @select="emit('select', $event)"
  >
    <template #trigger>
      <span class="sr-only">{{ label }}</span>
      <AppIcon name="more" :size="18" />
    </template>
  </KimaMenu>
</template>

<style scoped lang="scss">
.ui-menu-button { width: 40px; min-width: 0; }
:global(.ui-menu-button .kima-menu__trigger) {
  width: 40px;
  min-height: 40px;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--kima-color-on-surface-variant);
}
:global(.ui-menu-button .kima-menu__trigger:hover) {
  background: var(--kima-color-layer-3);
  color: var(--kima-color-on-surface);
}
/* KIMA Menu 的触发器固定带一个下拉箭头；图标触发模式下隐藏它。 */
:global(.ui-menu-button .kima-menu__trigger > svg[aria-hidden="true"]) {
  display: none !important;
}
</style>
