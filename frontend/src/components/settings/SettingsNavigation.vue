<!--
设置分类导航：用带 Tooltip 的图标按钮展示设置分类并发出切换意图。
设计思想：仅负责显示和事件，不持有业务数据，所有选中状态由调用方通过 props 控制。
调用示例：<SettingsNavigation :items="sections" :selected-id="selectedSectionID" @select="selectedSectionID = $event" />。
-->
<script setup>
import { HugeiconsIcon } from '@hugeicons/vue'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { ICON_STROKE_WIDTH } from '../../theme.js'

const props = defineProps({
  items: { type: Array, required: true },                   // 设置分类定义数组
  selectedId: { type: String, required: true },             // 当前选中分类的唯一身份
})

const emit = defineEmits(['select'])                        // 输出用户点击的分类 ID

</script>

<template>
  <section class="settings-navigation">
    <header class="settings-navigation__header">
      <m3e-heading variant="headline" size="small" level="1">设置</m3e-heading>
      <span>配置模型、工具和应用偏好</span>
    </header>
    <m3e-action-list class="settings-navigation__items" aria-label="设置分类">
      <m3e-list-action
        v-for="item in props.items"
        :key="item.id"
        class="settings-navigation__item"
        :aria-label="item.label"
        @click="emit('select', item.id)"
      >
        <HugeiconsIcon slot="leading" :icon="item.icon" :stroke-width="ICON_STROKE_WIDTH" />
        {{ item.label }}
        <span slot="supporting-text">{{ item.description }}</span>
        <HugeiconsIcon slot="trailing" :icon="ArrowRight01Icon" :stroke-width="ICON_STROKE_WIDTH" />
      </m3e-list-action>
    </m3e-action-list>
  </section>
</template>

<style scoped lang="scss">
/* --- 导航主容器：垂直排列图标按钮 --- */
.settings-navigation {
  display: flex;
  width: 100%;
  min-width: 0;
  overflow-y: auto;
  flex-direction: column;
  padding-bottom: 32px;
  @include scrollbar-dark;
}

.settings-navigation__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 28px 40px 20px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.settings-navigation__header span {
  color: var(--md-sys-color-outline);
  font-size: 13px;
}

.settings-navigation__items {
  width: min(720px, calc(100% - 80px));
  margin: 20px 40px 0;
}

/* --- 窄屏适配：导航改为横向顶部条 --- */
@media (max-width: 760px) {
  .settings-navigation {
    padding-bottom: 24px;
  }

  .settings-navigation__header { padding: 22px 20px 16px; }

  .settings-navigation__items {
    width: calc(100% - 40px);
    margin: 12px 20px 0;
  }
}
</style>
