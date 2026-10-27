<!--
图标触发的 KIMA 下拉菜单：用于列表行右侧的“更多操作”。
触发器直接用 KimaMenu 的 icon-only 模式，尺寸、圆形底和箭头都由组件负责。
调用示例：
<MenuButton label="会话的更多操作" :items="[{ value: 'rename', label: '重命名' }]" @select="run" />
-->
<script setup>
import { KimaMenu } from '@kernel4632/kima'
import { MoreVerticalIcon } from '@hugeicons/core-free-icons'

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
    icon-only
    size="small"
    :icon="MoreVerticalIcon"
    :items="items"
    :label="label"
    placement="bottom-end"
    @select="emit('select', $event)"
  />
</template>

<style scoped lang="scss">
/* 图标触发器的尺寸和箭头由 KIMA 负责；会话行里只保留图标，悬停才出现底色。 */
.ui-menu-button :deep(.kima-menu__trigger) {
  background: transparent;
  color: var(--la-secondary);
}
.ui-menu-button :deep(.kima-menu__trigger:hover) {
  background: var(--la-hover);
  color: var(--la-text);
}
</style>
