<!-- 供应商编辑器：编辑基础连接信息、模型列表和供应商自定义参数。 -->
<script setup>
import { ref, useId } from 'vue'                    // 控制 API Key 可见状态并生成表单字段 ID
import ProviderModels from './ProviderModels.vue'  // 模型管理保持独立，避免编辑器文件继续膨胀

const props = defineProps({ provider: { type: Object, required: true } })
const emit = defineEmits(['update:provider'])
const showApiKey = ref(false)
const fieldId = useId()

// --- 合并单个字段并提交完整供应商 ---
function updateProvider(patch) {
  emit('update:provider', { ...props.provider, ...patch })
}


// --- 合并自定义配置，保留未修改字段 ---
function updateCustom(field, value) {
  updateProvider({ custom: { ...props.provider.custom, [field]: value } })
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
      <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
        <label slot="label" :for="`${fieldId}-api-url`">请求地址（API）</label>
        <input :id="`${fieldId}-api-url`" :value="props.provider.apiUrl" type="url" placeholder="https://api.example.com/v1" @input="updateProvider({ apiUrl: $event.currentTarget.value })" />
      </m3e-form-field>
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

    <section class="provider-editor__section provider-editor__custom">
      <div class="provider-editor__section-heading">
        <m3e-heading variant="title" size="medium" level="3">自定义配置</m3e-heading>
        <span>不同供应商可按需忽略空字段</span>
      </div>
      <div class="provider-editor__custom-grid">
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-organization`">Organization</label>
          <input :id="`${fieldId}-organization`" :value="props.provider.custom.organization" type="text" placeholder="org_..." @input="updateCustom('organization', $event.currentTarget.value)" />
        </m3e-form-field>
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-project`">Project</label>
          <input :id="`${fieldId}-project`" :value="props.provider.custom.project" type="text" placeholder="proj_..." @input="updateCustom('project', $event.currentTarget.value)" />
        </m3e-form-field>
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-timeout`">请求超时（秒）</label>
          <input :id="`${fieldId}-timeout`" :value="props.provider.custom.timeout" type="number" min="1" @input="updateCustom('timeout', Number($event.currentTarget.value))" />
        </m3e-form-field>
        <m3e-form-field class="provider-editor__field" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-retries`">最大重试次数</label>
          <input :id="`${fieldId}-retries`" :value="props.provider.custom.maxRetries ?? 2" type="number" min="0" max="10" @input="updateCustom('maxRetries', Number($event.currentTarget.value))" />
        </m3e-form-field>
        <m3e-form-field class="provider-editor__field is-wide" variant="outlined" hide-subscript="always">
          <label slot="label" :for="`${fieldId}-headers`">自定义请求头（JSON）</label>
          <textarea :id="`${fieldId}-headers`" :value="props.provider.custom.headers ?? ''" rows="4" placeholder='{ "X-Custom-Header": "value" }' @input="updateCustom('headers', $event.currentTarget.value)"></textarea>
        </m3e-form-field>
      </div>
    </section>
  </form>
</template>

<style scoped lang="scss">
.provider-editor {
  display: flex;
  width: min(820px, 100%);
  margin: 0 auto;
  flex-direction: column;
  gap: 0;
  padding: 36px 40px 72px;
}

.provider-editor__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 28px;
}

.provider-editor__name-field { width: min(420px, 100%); }
.provider-editor__enabled { display: flex; align-items: center; flex: 0 0 auto; gap: 10px; color: #b2b2b2; font-size: 14px; }
.provider-editor__section { padding: 26px 0; border-top: 1px solid #282828; }
.provider-editor__section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.provider-editor__section-heading span { color: #777777; font-size: 12px; }
.provider-editor__field { width: 100%; min-width: 0; }
.provider-editor__field textarea { min-height: 96px; resize: vertical; }
.provider-editor__secret { display: flex; align-items: center; gap: 8px; }
.provider-editor__secret .provider-editor__field { flex: 1 1 auto; }
.provider-editor__custom-grid { display: flex; flex-wrap: wrap; gap: 18px; }
.provider-editor__custom-grid .provider-editor__field { flex: 1 1 calc(50% - 9px); }
.provider-editor__custom-grid .provider-editor__field.is-wide { flex-basis: 100%; }

@media (max-width: 760px) {
  .provider-editor { padding: 28px 22px 56px; }
}

@media (max-width: 520px) {
  .provider-editor__title-row { align-items: stretch; flex-direction: column; }
  .provider-editor__custom-grid .provider-editor__field { flex-basis: 100%; }
  .provider-editor__section-heading { align-items: stretch; flex-direction: column; }
}
</style>
