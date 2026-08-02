<!-- 供应商编辑器：编辑基础连接信息和已启用模型。 -->
<script setup>
import { ref, useId } from 'vue'                    // 管理 API Key 可见状态和表单 ID
import ProviderModels from './ProviderModels.vue'  // 模型管理保持独立，避免编辑器文件继续膨胀

const props = defineProps({ provider: { type: Object, required: true } })
const emit = defineEmits(['update:provider'])
const showApiKey = ref(false)
const fieldId = useId()

// --- 合并单个字段并提交完整供应商 ---
function updateProvider(patch) {
  emit('update:provider', { ...props.provider, ...patch })
}


</script>

<template>
  <form class="provider-editor" @submit.prevent>
    <header class="provider-editor__title-row">
      <m3e-form-field class="provider-editor__name-field" variant="outlined" hide-subscript="always">
        <label slot="label" :for="`${fieldId}-name`">供应商名</label>
        <input
          :id="`${fieldId}-name`"
          :value="props.provider.name"
          @input="updateProvider({ name: $event.currentTarget.value })"
        />
      </m3e-form-field>
      <label class="provider-editor__enabled">
        <span>{{ props.provider.enabled ? '已启用' : '已停用' }}</span>
        <m3e-switch :checked="props.provider.enabled" @change="updateProvider({ enabled: $event.currentTarget.checked })"></m3e-switch>
      </label>
    </header>

    <section class="provider-editor__section">
      <div class="provider-editor__connection">
        <m3e-form-field class="provider-editor__type-field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-api-type`">接口类型</label>
          <m3e-select :id="`${fieldId}-api-type`" @change="updateProvider({ apiType: $event.currentTarget.value })">
            <m3e-option value="openai-compatible" :selected="props.provider.apiType === 'openai-compatible'">OpenAI 兼容</m3e-option>
            <m3e-option value="anthropic" :selected="props.provider.apiType === 'anthropic'">Anthropic</m3e-option>
            <m3e-option value="gemini" :selected="props.provider.apiType === 'gemini'">Google Gemini</m3e-option>
            <m3e-option value="ollama" :selected="props.provider.apiType === 'ollama'">Ollama</m3e-option>
          </m3e-select>
        </m3e-form-field>
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-api-url`">请求地址（API）</label>
          <input :id="`${fieldId}-api-url`" :value="props.provider.apiUrl" type="url" placeholder="https://api.example.com/v1" @input="updateProvider({ apiUrl: $event.currentTarget.value })" />
        </m3e-form-field>
      </div>
    </section>

    <section class="provider-editor__section">
      <span class="provider-editor__secret">
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-api-key`">API Key</label>
          <input :id="`${fieldId}-api-key`" :value="props.provider.apiKey" :type="showApiKey ? 'text' : 'password'" autocomplete="off" placeholder="输入 API Key" @input="updateProvider({ apiKey: $event.currentTarget.value })" />
        </m3e-form-field>
          <m3e-icon-button type="button" :aria-label="showApiKey ? '隐藏 API Key' : '显示 API Key'" @click="showApiKey = !showApiKey">
            <m3e-icon :name="showApiKey ? 'visibility_off' : 'visibility'" filled="1"></m3e-icon>
          </m3e-icon-button>
      </span>
    </section>

    <section class="provider-editor__section">
      <ProviderModels :models="props.provider.models" @update:models="updateProvider({ models: $event })" />
    </section>

  </form>
</template>

<style scoped lang="scss">
.provider-editor {
  display: flex;
  width: min(820px, 100%);
  margin: 0 auto;
  flex-direction: column;
  gap: 28px;
  padding: 36px 40px 72px;
}

.provider-editor__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.provider-editor__name-field { width: min(420px, 100%); }
.provider-editor__enabled { display: flex; align-items: center; flex: 0 0 auto; gap: 10px; color: #a6a6a6; font-size: 13px; }
.provider-editor__section { padding: 0; }
.provider-editor__field { width: 100%; min-width: 0; }
.provider-editor__connection { display: flex; align-items: center; gap: 12px; }
.provider-editor__type-field { width: 220px; flex: 0 0 220px; }
.provider-editor__secret { display: flex; align-items: center; gap: 8px; }
.provider-editor__secret .provider-editor__field { flex: 1 1 auto; }

@media (max-width: 760px) {
  .provider-editor { padding: 28px 22px 56px; }
}

@media (max-width: 520px) {
  .provider-editor__title-row { align-items: stretch; flex-direction: column; }
  .provider-editor__connection { align-items: stretch; flex-direction: column; }
  .provider-editor__type-field { width: 100%; flex-basis: auto; }
}
</style>
