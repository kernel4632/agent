<!-- 供应商配置组合页：协调供应商选择、添加和单项更新。 -->
<script setup>
import { computed, ref, watch } from 'vue'       // 保持当前供应商选择始终有效
import ProviderEditor from './ProviderEditor.vue' // 右侧编辑当前供应商
import ProviderList from './ProviderList.vue'     // 左侧管理供应商集合

const props = defineProps({ providers: { type: Array, required: true } })
const emit = defineEmits(['update:providers'])
const selectedProviderId = ref(props.providers[0]?.id ?? '')

const selectedProvider = computed(() => props.providers.find(provider => provider.id === selectedProviderId.value) ?? null)

// --- 添加可立即编辑的新供应商 ---
function addProvider() {
  const providerNumber = props.providers.length + 1
  const newProvider = {
    id: `provider-${crypto.randomUUID()}`,
    name: `新供应商 ${providerNumber}`,
    enabled: true,
    apiType: 'openai-compatible',
    apiUrl: '',
    apiKey: '',
    models: [],
  }

  emit('update:providers', [...props.providers, newProvider])
  selectedProviderId.value = newProvider.id
}


// --- 用编辑后的完整对象替换当前供应商 ---
function updateProvider(updatedProvider) {
  emit('update:providers', props.providers.map(provider => provider.id === updatedProvider.id ? updatedProvider : provider))
}


watch(() => props.providers, providers => {
  if (providers.some(provider => provider.id === selectedProviderId.value)) return // 当前选择仍存在，无需跳转
  selectedProviderId.value = providers[0]?.id ?? ''                              // 删除或重载后回到首项
})
</script>

<template>
  <section class="provider-settings">
    <header class="provider-settings__header">
      <div>
        <m3e-heading variant="headline" size="small" level="2">供应商配置</m3e-heading>
        <span>{{ props.providers.length }} 个供应商</span>
      </div>
      <m3e-button type="button" variant="filled" @click="addProvider">
        <m3e-icon slot="icon" name="add" filled="1"></m3e-icon>
        添加供应商
      </m3e-button>
    </header>

    <div class="provider-settings__body">
      <ProviderList :providers="props.providers" :selected-id="selectedProviderId" @select="selectedProviderId = $event" />
      <div class="provider-settings__editor">
        <ProviderEditor v-if="selectedProvider" :provider="selectedProvider" @update:provider="updateProvider" />
        <div v-else class="provider-settings__empty">
          <span>添加一个供应商以开始配置</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.provider-settings {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.provider-settings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: 20px;
  padding: 26px 32px 22px;
  border-bottom: 1px solid #242424;
}

.provider-settings__header > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.provider-settings__header span { color: #7f7f7f; font-size: 13px; }

.provider-settings__body {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
}

.provider-settings__editor {
  min-width: 0;
  overflow-y: auto;
  flex: 1 1 auto;
  scrollbar-width: thin;
  scrollbar-color: #555555 transparent;
}

.provider-settings__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 420px;
  color: #777777;
}

@media (max-width: 680px) {
  .provider-settings__header { align-items: flex-start; padding: 20px 16px; }
  .provider-settings__body { flex-direction: column; }
  .provider-settings__editor { overflow: visible; }
}
</style>
