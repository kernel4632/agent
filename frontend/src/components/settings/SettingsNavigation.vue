<!--
设置分类导航：用带 Tooltip 的图标按钮展示设置分类并发出切换意图。
设计思想是仅负责显示和事件，不持有业务数据，所有选中状态由调用方通过 props 控制。
调用示例：<SettingsNavigation :items="sections" :selected-id="currentSection" @select="switchSection" />。
-->
<script setup>
const props = defineProps({
  items: { type: Array, required: true },
  selectedId: { type: String, required: true },
})

const emit = defineEmits(['select'])
</script>

<template>
  <nav class="settings-navigation" aria-label="设置分类">
    <div class="settings-navigation__items">
      <div
        v-for="item in props.items"
        :key="item.id"
        class="settings-navigation__item"
      >
        <m3e-icon-button
          :id="`settings-nav-${item.id}`"
          type="button"
          shape="rounded"
          :variant="item.id === props.selectedId ? 'filled' : 'standard'"
          :aria-label="item.label"
          :aria-current="item.id === props.selectedId ? 'page' : undefined"
          @click="emit('select', item.id)"
        >
          <m3e-icon :name="item.icon" filled="1"></m3e-icon>
        </m3e-icon-button>
        <m3e-tooltip :for="`settings-nav-${item.id}`" position="after">{{ item.label }}</m3e-tooltip>
      </div>
    </div>
  </nav>
</template>

<style scoped lang="scss">
.settings-navigation {
  display: flex;
  align-items: center;
  flex: 0 0 80px;
  flex-direction: column;
  padding: 24px 12px;
  border-right: 1px solid #242424;
  background: #0d0d0d;
}

.settings-navigation__items {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 8px;
}

.settings-navigation__item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
}

.settings-navigation__item m3e-icon-button {
  --m3e-icon-button-icon-color: #a9a9a9;
  --m3e-icon-button-hover-icon-color: #f2f2f2;
  --m3e-filled-icon-button-container-color: rgba(255, 255, 255, .12);
  --m3e-filled-icon-button-icon-color: #ffffff;
  --m3e-filled-icon-button-hover-icon-color: #ffffff;
  --m3e-filled-icon-button-focus-icon-color: #ffffff;
  --m3e-filled-icon-button-pressed-icon-color: #ffffff;
}

@media (max-width: 760px) {
  .settings-navigation {
    flex: none;
    width: 100%;
    padding: 10px 16px;
    overflow-x: auto;
    scrollbar-width: none;
    border-right: 0;
    border-bottom: 1px solid #242424;

    &::-webkit-scrollbar { display: none; }
  }

  .settings-navigation__items {
    flex-direction: row;
    width: max-content;
  }
}
</style>
