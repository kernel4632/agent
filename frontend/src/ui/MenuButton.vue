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
  <!-- placement 靠右对齐：抽屉贴着视口右边，默认的 bottom-start 会把弹层挤出屏幕。 -->
  <KimaMenu
    class="ui-menu-button"
    :items="items"
    :label="label"
    placement="bottom-end"
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
/* :deep 生成 .ui-menu-button[data-v-…] .kima-menu__trigger，特异性才够压过 KIMA 的 56px 默认触发行。 */
.ui-menu-button :deep(.kima-menu__trigger) {
  width: 40px;
  min-height: 40px;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--kima-color-on-surface-variant);
}
.ui-menu-button :deep(.kima-menu__trigger:hover) {
  background: var(--kima-color-layer-3);
  color: var(--kima-color-on-surface);
}
/*
 * KIMA 0.7.1 的 KimaMenu 会在插槽内容后固定补一个下拉箭头，图标触发模式下这个箭头多余。
 * 只隐藏最后一个直接子 svg（KIMA 生成的箭头），不能按 aria-hidden 批量隐藏，否则插槽里的图标也会消失。
 * 等 KIMA 提供“隐藏箭头”属性后可删除：https://github.com/kernel4632/kima/issues/4
 */
.ui-menu-button :deep(.kima-menu__trigger > svg:last-child) {
  display: none;
}
</style>
