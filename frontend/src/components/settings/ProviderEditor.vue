<script setup>
import { ref } from 'vue'
import ProviderModels from './ProviderModels.vue'
const props = defineProps({ provider: { type: Object, required: true } })
const emit = defineEmits(['delete', 'update:provider'])
const showApiKey = ref(false)
const deleteDialog = ref(null)
const update = patch => emit('update:provider', { ...props.provider, ...patch })
</script>

<template>
  <div class="provider-editor">
    <label class="provider-editor__field">供应商名<input class="field" :value="provider.name" @input="update({ name: $event.target.value })" /></label>
    <label class="provider-editor__enabled"><span>启用此供应商</span><input class="switch" type="checkbox" role="switch" :checked="provider.enabled" @change="update({ enabled: $event.target.checked })" /></label>
    <label class="provider-editor__field">接口类型<select class="field" :value="provider.apiType" @change="update({ apiType: $event.target.value })"><option value="openai-compatible">OpenAI 兼容</option></select></label>
    <label class="provider-editor__field">请求地址（API）<input class="field" type="url" :value="provider.apiUrl" placeholder="https://api.example.com/v1" @input="update({ apiUrl: $event.target.value })" /></label>
    <div class="provider-editor__secret"><label class="provider-editor__field">API Key<input class="field" :type="showApiKey ? 'text' : 'password'" autocomplete="off" :value="provider.apiKey" placeholder="输入 API Key" @input="update({ apiKey: $event.target.value })" /></label><button class="text-button" :aria-label="showApiKey ? '隐藏 API Key' : '显示 API Key'" @click="showApiKey = !showApiKey">{{ showApiKey ? '隐藏' : '显示' }}</button></div>
    <ProviderModels :provider="provider" :models="provider.models" @update:models="update({ models: $event })" />
    <footer><button class="text-button provider-editor__delete" @click="deleteDialog.showModal()">删除供应商</button></footer>
  </div>
  <dialog ref="deleteDialog" class="dialog" aria-label="删除供应商确认"><h2>删除供应商？</h2><p>保存设置后，此供应商配置将被移除。</p><div class="dialog-actions"><button class="button" @click="deleteDialog.close()">取消</button><button class="button button--danger" @click="emit('delete')">删除</button></div></dialog>
</template>

<style scoped lang="scss">
.provider-editor {
  display: grid; gap: 16px; min-width: 0;
  &__field { display: grid; flex: 1; min-width: 0; gap: 8px; color: var(--la-secondary); font-size: 12px; }
  .field { background: var(--la-setting-row); font-size: 13px; }
  &__enabled { display: flex; align-items: center; justify-content: space-between; color: var(--la-secondary); font-size: 12px; }
  &__secret { display: flex; align-items: end; gap: 12px; }
  &__secret button { margin-bottom: 9px; }
  &__delete { color: var(--la-danger); }
  footer { padding-top: 12px; border-top: 1px solid var(--la-line); }
}
</style>
