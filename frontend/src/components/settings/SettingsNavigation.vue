<!-- 设置分类导航：用带提示的图标按钮展示分类并发出切换意图。 -->
<script setup>
import { t } from '../../i18n.js'

const props = defineProps({
  sections: { type: Array, default: () => [] },
  active: { type: String, default: '' },
})

const emit = defineEmits(['select'])
</script>

<template>
  <nav class="settings-navigation" :aria-label="t('settings')">
    <div class="settings-navigation__items">
      <div v-for="section in props.sections" :key="section.id" class="settings-navigation__item">
        <m3e-icon-button
          :id="`settings-nav-${section.id}`"
          type="button"
          shape="rounded"
          :variant="section.id === props.active ? 'filled' : 'standard'"
          :aria-label="t(section.label)"
          :aria-current="section.id === props.active ? 'page' : undefined"
          @click="emit('select', section.id)"
        >
          <m3e-icon :name="section.icon"></m3e-icon>
        </m3e-icon-button>
        <m3e-tooltip :for="`settings-nav-${section.id}`" position="after">{{ t(section.label) }}</m3e-tooltip>
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
    position: sticky;
    z-index: 12;
    top: 0;
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
