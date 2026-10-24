<!--
供应商列表：展示所有供应商名称和启用状态，选中项高亮，点击发出 select。
列表项使用 KIMA 的 KimaChip，不再使用手写按钮或自定义样式。
调用示例：<ProviderList :providers="providers" :selected-id="selectedId" @select="selectProvider" />
-->
<script setup>
import { KimaChip, KimaFlex } from '@kernel4632/kima'

defineProps({ providers: { type: Array, required: true }, selectedId: String })
defineEmits(['select'])
</script>

<template>
  <KimaFlex wrap="wrap" :gap="2" aria-label="供应商列表">
    <KimaChip
      v-for="provider in providers"
      :key="provider.id"
      selectable
      :label="provider.name"
      :model-value="provider.id === selectedId"
      @change="$emit('select', provider.id)"
    >{{ provider.name }}<template v-if="!provider.enabled"> · 停用</template></KimaChip>
  </KimaFlex>
</template>
