<!--
供应商配置组合页：协调供应商列表选择和单项字段更新。
设计思想：桌面上左侧窄列表、右侧宽表单，窄屏纵向堆叠；数组通过 v-model:providers 双向绑定，由设置页统一保存。
调用示例：<ProviderSettings v-model:providers="settingsDraft.providers" />
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { KimaTypography } from '@kernel4632/kima'
import ProviderEditor from './ProviderEditor.vue'
import ProviderList from './ProviderList.vue'

const props = defineProps({ providers: { type: Array, required: true } })
const emit = defineEmits(['update:providers'])
const selectedProviderID = ref(props.providers[0]?.id ?? '')
const selectedProvider = computed(() => props.providers.find(provider => provider.id === selectedProviderID.value) ?? null)

function updateProvider(updatedProvider) {
  emit('update:providers', props.providers.map(provider => provider.id === updatedProvider.id ? updatedProvider : provider))
}

function removeProvider() {
  const index = props.providers.findIndex(provider => provider.id === selectedProviderID.value)
  if (index < 0) return
  const nextProvider = props.providers[index + 1] ?? props.providers[index - 1]
  emit('update:providers', props.providers.filter(provider => provider.id !== selectedProviderID.value))
  selectedProviderID.value = nextProvider?.id ?? ''
}

watch(() => props.providers.map(provider => provider.id), (ids, previousIDs) => {
  const addedID = ids.find(id => !previousIDs.includes(id))
  if (addedID) selectedProviderID.value = addedID
  else if (!ids.includes(selectedProviderID.value)) selectedProviderID.value = ids[0] ?? ''
})
</script>

<template>
  <div class="provider-settings">
    <ProviderList :providers="props.providers" :selected-id="selectedProviderID" @select="selectedProviderID = $event" />
    <ProviderEditor
      v-if="selectedProvider"
      :key="selectedProvider.id"
      :provider="selectedProvider"
      @update:provider="updateProvider"
      @delete="removeProvider"
    />
    <KimaTypography v-else type="caption">添加一个供应商以开始配置</KimaTypography>
  </div>
</template>

<style scoped lang="scss">
.provider-settings {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
  min-width: 0;
}
@media (max-width: 767px) {
  .provider-settings { grid-template-columns: minmax(0, 1fr); }
}
</style>
