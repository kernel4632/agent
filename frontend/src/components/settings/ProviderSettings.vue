<!-- 供应商配置组合页：复用正式设置指令并协调列表与编辑器。 -->
<script setup>
import { computed, ref, watch } from 'vue'
import { Settings } from '../../commands/settings.js'
import ProviderEditor from './ProviderEditor.vue'
import ProviderList from './ProviderList.vue'

const props = defineProps({ config: { type: Object, required: true } })
const selectedName = ref('')
const modelsLoading = ref(false)

const providerNames = computed(() => Object.keys(props.config.providers || {}))
const providers = computed(() => providerNames.value.map(name => ({ name, ...props.config.providers[name] })))
const selectedProvider = computed(() => props.config.providers?.[selectedName.value] || null)

watch(providerNames, (names) => {
  if (!names.includes(selectedName.value)) selectedName.value = names[0] || ''
}, { immediate: true })

function addProvider() {
  selectedName.value = Settings.addProvider()
}

function updateProvider(field, value) {
  if (field !== 'name') {
    Settings.updateProvider(selectedName.value, field, value)
    return
  }

  const renamed = Settings.renameProvider(selectedName.value, value)
  if (renamed && renamed !== true) selectedName.value = renamed
}

async function fetchModels() {
  modelsLoading.value = true
  try { return await Settings.fetchModels(selectedName.value) }
  finally { modelsLoading.value = false }
}
</script>

<template>
  <section class="provider-settings">
    <header class="provider-settings__header">
      <div>
        <m3e-heading variant="headline" size="small" level="2">供应商配置</m3e-heading>
        <span>{{ providerNames.length }} 个供应商</span>
      </div>
      <m3e-button type="button" variant="filled" @click="addProvider">
        <m3e-icon slot="icon" name="add"></m3e-icon>
        添加供应商
      </m3e-button>
    </header>

    <div class="provider-settings__body">
      <ProviderList :providers="providers" :selected-name="selectedName" @select="selectedName = $event" />
      <div class="provider-settings__editor">
        <ProviderEditor
          v-if="selectedProvider"
          :key="selectedName"
          :provider-name="selectedName"
          :provider="selectedProvider"
          :loading-models="modelsLoading"
          :fetch-models="fetchModels"
          @update="updateProvider"
          @add-model="Settings.addModel(selectedName, $event)"
          @remove-model="Settings.removeModel(selectedName, $event)"
        />
        <div v-else class="provider-settings__empty"><span>添加一个供应商以开始配置</span></div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.provider-settings { display: flex; width: 100%; min-width: 0; min-height: 0; flex-direction: column; }
.provider-settings__header { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; gap: 20px; padding: 26px 32px 22px; border-bottom: 1px solid #242424; }
.provider-settings__header > div { display: flex; flex-direction: column; gap: 4px; }
.provider-settings__header span { color: #7f7f7f; font-size: 13px; }
.provider-settings__body { display: flex; min-width: 0; min-height: 0; flex: 1 1 auto; }
.provider-settings__editor { min-width: 0; overflow-y: auto; flex: 1 1 auto; scrollbar-width: thin; scrollbar-color: #555555 transparent; }
.provider-settings__empty { display: flex; align-items: center; justify-content: center; min-height: 420px; color: #777777; }
@media (max-width: 680px) {
  .provider-settings__header { align-items: flex-start; padding: 20px 16px; }
  .provider-settings__body { flex-direction: column; }
  .provider-settings__editor { overflow: visible; }
}
</style>
