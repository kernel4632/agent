<!-- 设置分类导航：只负责展示分类和发出切换意图。 -->
<script setup>
const props = defineProps({
  items: { type: Array, required: true },
  selectedId: { type: String, required: true },
})

const emit = defineEmits(['select'])
</script>

<template>
  <nav class="settings-navigation" aria-label="设置分类">
    <m3e-heading variant="title" size="large" level="1">设置</m3e-heading>
    <div class="settings-navigation__items">
      <m3e-button
        v-for="item in props.items"
        :key="item.id"
        class="settings-navigation__item"
        :class="{ 'is-selected': item.id === props.selectedId }"
        type="button"
        shape="rounded"
        @click="emit('select', item.id)"
      >
        <m3e-icon slot="icon" :name="item.icon" filled="1"></m3e-icon>
        {{ item.label }}
      </m3e-button>
    </div>
  </nav>
</template>

<style scoped lang="scss">
.settings-navigation {
  display: flex;
  flex: 0 0 248px;
  flex-direction: column;
  gap: 28px;
  padding: 32px 20px;
  border-right: 1px solid #242424;
  background: #0d0d0d;
}

.settings-navigation__items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-navigation__item {
  --m3e-button-container-color: transparent;
  --m3e-button-label-text-color: #a9a9a9;
  justify-content: flex-start;
  width: 100%;

  &.is-selected {
    --m3e-button-container-color: #2d2d2d;
    --m3e-button-label-text-color: #f2f2f2;
  }
}

@media (max-width: 760px) {
  .settings-navigation {
    flex: none;
    width: 100%;
    padding: 18px 16px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid #242424;
  }

  .settings-navigation__items {
    flex-direction: row;
    width: max-content;
  }

  .settings-navigation__item { width: auto; }
}
</style>
