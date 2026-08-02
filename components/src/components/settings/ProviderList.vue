<!-- 供应商列表：展示供应商状态，并发出选择或新增意图。 -->
<script setup>
const props = defineProps({
  providers: { type: Array, required: true },
  selectedId: { type: String, default: '' },
})

const emit = defineEmits(['add', 'select'])
</script>

<template>
  <aside class="provider-list" aria-label="供应商列表">
    <div class="provider-list__header">
      <m3e-heading variant="title" size="medium" level="2">供应商</m3e-heading>
      <span>{{ props.providers.length }}</span>
    </div>

    <div class="provider-list__items">
      <button
        v-for="provider in props.providers"
        :key="provider.id"
        class="provider-list__item"
        :class="{ 'is-selected': provider.id === props.selectedId }"
        type="button"
        @click="emit('select', provider.id)"
      >
        <span class="provider-list__mark">{{ provider.name.slice(0, 1).toUpperCase() }}</span>
        <span class="provider-list__name">{{ provider.name }}</span>
        <span class="provider-list__status" :class="{ 'is-enabled': provider.enabled }"></span>
      </button>
    </div>

    <m3e-button class="provider-list__add" type="button" variant="outlined" shape="rounded" @click="emit('add')">
      <m3e-icon slot="icon" name="add" filled="1"></m3e-icon>
      添加供应商
    </m3e-button>
  </aside>
</template>

<style scoped lang="scss">
.provider-list {
  display: flex;
  flex: 0 0 236px;
  flex-direction: column;
  min-height: 0;
  gap: 16px;
  padding: 28px 16px 20px;
  border-right: 1px solid #242424;
  background: #101010;
}

.provider-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-inline: 8px;
  color: #858585;
  font-size: 13px;
}

.provider-list__items {
  display: flex;
  overflow-y: auto;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
}

.provider-list__item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 48px;
  gap: 10px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #b7b7b7;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;

  &:hover { background: #202020; color: #eeeeee; }
  &.is-selected { background: #2b2b2b; color: #ffffff; }
}

.provider-list__mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border-radius: 8px;
  background: #3a3a3a;
  color: #f2f2f2;
  font-weight: 700;
}

.provider-list__name {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-list__status {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: #555555;

  &.is-enabled { background: #d9d9d9; }
}

.provider-list__add { width: 100%; }

@media (max-width: 980px) {
  .provider-list { flex-basis: 200px; }
}

@media (max-width: 680px) {
  .provider-list {
    flex: none;
    width: 100%;
    min-height: auto;
    padding: 16px;
    border-right: 0;
    border-bottom: 1px solid #242424;
  }

  .provider-list__items {
    overflow-x: auto;
    flex-direction: row;
  }

  .provider-list__item { min-width: 170px; }
  .provider-list__add { align-self: flex-start; width: auto; }
}
</style>
