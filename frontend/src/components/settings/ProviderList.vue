<!--
供应商列表：左侧供应商选择面板，展示供应商名称、API 地址和启用状态。
设计思想：纯展示组件，不持有业务状态，选中项由父组件通过 props 控制，点击时输出选择意图。
核心数据：providers（供应商数组）、selectedId（当前选中的供应商 ID）。
调用示例：<ProviderList :providers="providers" :selected-id="selectedProviderID" @select="selectedProviderID = $event" />。
-->
<script setup>
const props = defineProps({
  providers: { type: Array, required: true },       // 接收完整供应商数组
  selectedId: { type: String, default: '' },        // 接收当前选中供应商的唯一 ID
})

const emit = defineEmits(['select'])                // 输出用户选择的供应商 ID


</script>

<template>
  <aside class="provider-list" aria-label="供应商列表">
    <m3e-action-list class="provider-list__items" aria-label="供应商">
      <m3e-list-action
        v-for="provider in props.providers"
        :key="provider.id"
        class="provider-list__item"
        :class="{ 'is-selected': provider.id === props.selectedId }"
        @click="emit('select', provider.id)"
      >
        <span class="provider-list__name">{{ provider.name }}</span>
        <span slot="supporting-text" class="provider-list__endpoint">{{ provider.apiUrl || '未配置请求地址' }}</span>
        <span slot="trailing" class="provider-list__state" :class="{ 'is-enabled': provider.enabled }">
          {{ provider.enabled ? '启用' : '停用' }}
        </span>
      </m3e-list-action>
    </m3e-action-list>
  </aside>
</template>

<style scoped lang="scss">
/* --- 供应商列表侧边栏：固定宽度，垂直滚动 --- */
.provider-list {
  display: flex;
  flex: 0 0 236px;
  flex-direction: column;
  min-height: 0;
  padding: 12px 14px 20px;
  border-right: 1px solid #242424;
  background: #101010;
}

/* --- 列表容器：允许纵向滚动 --- */
.provider-list__items {
  display: flex;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
}

/* --- 单个供应商行：未选中和选中态样式 --- */
.provider-list__item {
  --m3e-list-item-container-color: transparent;
  --m3e-list-item-label-text-color: #b7b7b7;
  width: 100%;

  &.is-selected {
    --m3e-list-item-container-color: #2b2b2b;
    --m3e-list-item-label-text-color: #ffffff;
  }
}

/* --- 供应商名称：溢出截断 --- */
.provider-list__name {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- API 地址辅助文本：溢出截断 --- */
.provider-list__endpoint {
  display: block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- 启用/停用状态标签 --- */
.provider-list__state {
  color: #777777;
  font-size: 12px;

  &.is-enabled { color: #d3d3d3; }
}

/* --- 中等屏幕：缩窄侧边栏宽度 --- */
@media (max-width: 980px) {
  .provider-list { flex-basis: 200px; }
}

/* --- 窄屏适配：改为横向滚动条 --- */
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
