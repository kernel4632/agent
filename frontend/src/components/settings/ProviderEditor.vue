<!-- 供应商编辑器：编辑正式配置中的连接信息和模型目录。 -->
<script setup>
import { ref, useId } from 'vue'
import ProviderModels from './ProviderModels.vue'

const props = defineProps({
  providerName: { type: String, required: true },
  provider: { type: Object, required: true },
  loadingModels: { type: Boolean, default: false },
  fetchModels: { type: Function, required: true },
})

const emit = defineEmits(['update', 'add-model', 'remove-model'])
const showApiKey = ref(false)
const fieldId = useId()
</script>

<template>
  <form class="provider-editor" @submit.prevent>
    <header class="provider-editor__title-row">
      <m3e-form-field class="provider-editor__name-field" variant="outlined" hide-subscript="always">
        <label slot="label" :for="`${fieldId}-name`">供应商名</label>
        <input :id="`${fieldId}-name`" :value="props.providerName" @change="emit('update', 'name', $event.currentTarget.value)" />
      </m3e-form-field>
      <label class="provider-editor__enabled">
        <span>{{ props.provider.enabled ? '已启用' : '已停用' }}</span>
        <m3e-switch :checked="props.provider.enabled" @change="emit('update', 'enabled', $event.currentTarget.checked)"></m3e-switch>
      </label>
    </header>

    <section class="provider-editor__section">
      <div class="provider-editor__connection">
        <m3e-form-field class="provider-editor__type-field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-protocol`">接口类型</label>
          <m3e-select :id="`${fieldId}-protocol`" @change="emit('update', 'protocol', $event.currentTarget.value)">
            <m3e-option value="openai-compatible" :selected="props.provider.protocol === 'openai-compatible'">OpenAI 兼容</m3e-option>
            <m3e-option value="anthropic" :selected="props.provider.protocol === 'anthropic'">Anthropic</m3e-option>
            <m3e-option value="gemini" :selected="props.provider.protocol === 'gemini'">Google Gemini</m3e-option>
            <m3e-option value="ollama" :selected="props.provider.protocol === 'ollama'">Ollama</m3e-option>
          </m3e-select>
        </m3e-form-field>
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-api-url`">请求地址（API）</label>
          <input :id="`${fieldId}-api-url`" :value="props.provider.baseURL" type="url" placeholder="https://api.example.com/v1" @input="emit('update', 'baseURL', $event.currentTarget.value)" />
        </m3e-form-field>
      </div>
    </section>

    <section class="provider-editor__section">
      <span class="provider-editor__secret">
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-api-key`">API Key</label>
          <input :id="`${fieldId}-api-key`" :value="props.provider.apiKey" :type="showApiKey ? 'text' : 'password'" autocomplete="off" placeholder="输入 API Key" @input="emit('update', 'apiKey', $event.currentTarget.value)" />
        </m3e-form-field>
        <m3e-icon-button type="button" :aria-label="showApiKey ? '隐藏 API Key' : '显示 API Key'" @click="showApiKey = !showApiKey">
          <m3e-icon :name="showApiKey ? 'visibility_off' : 'visibility'"></m3e-icon>
        </m3e-icon-button>
      </span>
    </section>

    <section class="provider-editor__section">
      <ProviderModels
        :models="props.provider.models"
        :loading="props.loadingModels"
        :fetch-models="props.fetchModels"
        @add="emit('add-model', $event)"
        @remove="emit('remove-model', $event)"
      />
    </section>
  </form>
</template>

<style scoped lang="scss">
.provider-editor { display: flex; width: min(820px, 100%); margin: 0 auto; flex-direction: column; gap: 28px; padding: 36px 40px 72px; }
.provider-editor__title-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.provider-editor__name-field { width: min(420px, 100%); }
.provider-editor__enabled { display: flex; align-items: center; flex: 0 0 auto; gap: 10px; color: #a6a6a6; font-size: 13px; }
.provider-editor__section { padding: 0; }
.provider-editor__field { width: 100%; min-width: 0; }
.provider-editor__connection { display: flex; align-items: center; gap: 12px; }
.provider-editor__type-field { width: 220px; flex: 0 0 220px; }
.provider-editor__secret { display: flex; align-items: center; gap: 8px; }
.provider-editor__secret .provider-editor__field { flex: 1 1 auto; }
@media (max-width: 760px) { .provider-editor { padding: 28px 22px 56px; } }
@media (max-width: 520px) {
  .provider-editor__title-row { align-items: stretch; flex-direction: column; }
  .provider-editor__connection { align-items: stretch; flex-direction: column; }
  .provider-editor__type-field { width: 100%; flex-basis: auto; }
}
</style>
