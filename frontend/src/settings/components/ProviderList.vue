<!--
供应商列表：展示所有供应商名称和启用状态，选中项高亮，点击发出 select。
列表项使用 KIMA 的 KimaChip，纵向排列，和右侧表单形成清楚的选择关系。
调用示例：<ProviderList :providers="providers" :selected-id="selectedId" @select="selectProvider" />
-->
<script setup>
import { KimaChip, KimaFlex } from '@kernel4632/kima'

defineProps({ providers: { type: Array, required: true }, selectedId: String })
defineEmits(['select'])
</script>

<template>
  <aside class="provider-list" aria-label="供应商列表">
    <span class="provider-list__label">供应商</span>
    <KimaFlex direction="column" :gap="1">
      <KimaChip
        v-for="provider in providers"
        :key="provider.id"
        class="provider-chip"
        selectable
        :label="provider.name"
        :model-value="provider.id === selectedId"
        @change="$emit('select', provider.id)"
      >{{ provider.name }}<template v-if="!provider.enabled"> · 停用</template></KimaChip>
    </KimaFlex>
  </aside>
</template>

<style scoped lang="scss">
.provider-list {
  padding: 16px;
  border-radius: 20px;
  background: var(--la-layer-01);
}
.provider-list__label {
  display: block;
  padding: 0 6px 10px;
  color: var(--la-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.provider-chip { width: 100%; justify-content: flex-start; }
</style>
