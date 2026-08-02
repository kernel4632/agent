<!-- 供应商编辑器：编辑基础连接信息、模型列表和供应商自定义参数。 -->
<script setup>
import { ref } from 'vue'                           // 控制 API Key 的可见状态
import ProviderModels from './ProviderModels.vue'  // 模型管理保持独立，避免编辑器文件继续膨胀

const props = defineProps({ provider: { type: Object, required: true } })
const emit = defineEmits(['update:provider'])
const showApiKey = ref(false)

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
      <div>
        <span class="provider-editor__eyebrow">供应商配置</span>
        <input
          class="provider-editor__name"
          :value="props.provider.name"
          aria-label="供应商名"
          @input="updateProvider({ name: $event.currentTarget.value })"
        />
      </div>
      <label class="provider-editor__enabled">
        <span>{{ props.provider.enabled ? '已启用' : '已停用' }}</span>
        <m3e-switch :checked="props.provider.enabled" @change="updateProvider({ enabled: $event.currentTarget.checked })"></m3e-switch>
      </label>
    </header>

    <section class="provider-editor__section">
      <label class="provider-editor__field">
        <span>请求地址（API）</span>
        <input :value="props.provider.apiUrl" type="url" placeholder="https://api.example.com/v1" @input="updateProvider({ apiUrl: $event.currentTarget.value })" />
      </label>
    </section>

    <section class="provider-editor__section">
      <label class="provider-editor__field">
        <span>API Key</span>
        <span class="provider-editor__secret">
          <input :value="props.provider.apiKey" :type="showApiKey ? 'text' : 'password'" autocomplete="off" placeholder="输入 API Key" @input="updateProvider({ apiKey: $event.currentTarget.value })" />
          <m3e-icon-button type="button" shape="rounded" :aria-label="showApiKey ? '隐藏 API Key' : '显示 API Key'" @click="showApiKey = !showApiKey">
            <m3e-icon :name="showApiKey ? 'visibility_off' : 'visibility'" filled="1"></m3e-icon>
          </m3e-icon-button>
        </span>
      </label>
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
        <label class="provider-editor__field">
          <span>Organization</span>
          <input :value="props.provider.custom.organization" type="text" placeholder="org_..." @input="updateCustom('organization', $event.currentTarget.value)" />
        </label>
        <label class="provider-editor__field">
          <span>Project</span>
          <input :value="props.provider.custom.project" type="text" placeholder="proj_..." @input="updateCustom('project', $event.currentTarget.value)" />
        </label>
        <label class="provider-editor__field">
          <span>请求超时（秒）</span>
          <input :value="props.provider.custom.timeout" type="number" min="1" @input="updateCustom('timeout', Number($event.currentTarget.value))" />
        </label>
        <label class="provider-editor__field">
          <span>最大重试次数</span>
          <input :value="props.provider.custom.maxRetries ?? 2" type="number" min="0" max="10" @input="updateCustom('maxRetries', Number($event.currentTarget.value))" />
        </label>
        <label class="provider-editor__field is-wide">
          <span>自定义请求头（JSON）</span>
          <textarea :value="props.provider.custom.headers ?? ''" rows="4" placeholder='{ "X-Custom-Header": "value" }' @input="updateCustom('headers', $event.currentTarget.value)"></textarea>
        </label>
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

.provider-editor__title-row > div { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
.provider-editor__eyebrow { color: #858585; font-size: 12px; }
.provider-editor__name { width: min(420px, 100%); padding: 0; border: 0; outline: 0; background: transparent; color: #f0f0f0; font: 600 26px/1.3 Inter, sans-serif; }
.provider-editor__enabled { display: flex; align-items: center; flex: 0 0 auto; gap: 10px; color: #b2b2b2; font-size: 14px; }
.provider-editor__section { padding: 26px 0; border-top: 1px solid #282828; }
.provider-editor__section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.provider-editor__section-heading span { color: #777777; font-size: 12px; }
.provider-editor__field { display: flex; min-width: 0; flex-direction: column; gap: 9px; color: #ababab; font-size: 13px; }
.provider-editor__field input,
.provider-editor__field textarea { width: 100%; border: 1px solid #3b3b3b; border-radius: 7px; outline: none; background: #151515; color: #ededed; font: inherit; }
.provider-editor__field input { height: 46px; padding: 0 13px; }
.provider-editor__field textarea { resize: vertical; padding: 12px 13px; line-height: 1.6; }
.provider-editor__field input:focus,
.provider-editor__field textarea:focus { border-color: #888888; }
.provider-editor__secret { display: flex; align-items: center; gap: 8px; }
.provider-editor__secret input { flex: 1 1 auto; }
.provider-editor__custom-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.provider-editor__field.is-wide { grid-column: 1 / -1; }

@media (max-width: 760px) {
  .provider-editor { padding: 28px 22px 56px; }
}

@media (max-width: 520px) {
  .provider-editor__title-row { align-items: flex-start; flex-direction: column; }
  .provider-editor__custom-grid { grid-template-columns: 1fr; }
  .provider-editor__field.is-wide { grid-column: auto; }
  .provider-editor__section-heading { align-items: flex-start; flex-direction: column; }
}
</style>
