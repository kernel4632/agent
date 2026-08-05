<!-- 供应商列表：展示供应商状态并发出选择意图。 -->
<script setup>
const props = defineProps({
  providers: { type: Array, required: true },
  selectedName: { type: String, default: '' },
})

const emit = defineEmits(['select'])
</script>

<template>
  <aside class="provider-list" aria-label="供应商列表">
    <m3e-action-list class="provider-list__items" aria-label="供应商">
      <m3e-list-action
        v-for="provider in props.providers"
        :key="provider.name"
        class="provider-list__item"
        :class="{ 'is-selected': provider.name === props.selectedName }"
        @click="emit('select', provider.name)"
      >
        <span class="provider-list__name">{{ provider.name }}</span>
        <span slot="supporting-text" class="provider-list__endpoint">{{ provider.baseURL || '未配置请求地址' }}</span>
        <span slot="trailing" class="provider-list__state" :class="{ 'is-enabled': provider.enabled }">
          {{ provider.enabled ? '启用' : '停用' }}
        </span>
      </m3e-list-action>
    </m3e-action-list>
  </aside>
</template>

<style scoped lang="scss">
.provider-list {
  display: flex;
  flex: 0 0 236px;
  flex-direction: column;
  min-height: 0;
  padding: 12px 14px 20px;
  border-right: 1px solid #242424;
  background: #101010;
}

.provider-list__items {
  display: flex;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
}

.provider-list__item {
  --m3e-list-item-container-color: transparent;
  --m3e-list-item-label-text-color: #b7b7b7;
  width: 100%;

  &.is-selected {
    --m3e-list-item-container-color: #2b2b2b;
    --m3e-list-item-label-text-color: #ffffff;
  }
}

.provider-list__name {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-list__endpoint {
  display: block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-list__state { color: #777777; font-size: 12px; }
.provider-list__state.is-enabled { color: #d3d3d3; }

@media (max-width: 980px) {
  .provider-list { flex-basis: 200px; }
}

@media (max-width: 680px) {
  .provider-list {
    flex: none;
    width: 100%;
    min-height: auto;
    padding: 8px 12px 12px;
    border-right: 0;
    border-bottom: 1px solid #242424;
  }

  .provider-list__items {
    overflow-x: auto;
    flex-direction: row;
    scrollbar-width: none;

    &::-webkit-scrollbar { display: none; }
  }

  .provider-list__item { min-width: 170px; }
}
</style>
