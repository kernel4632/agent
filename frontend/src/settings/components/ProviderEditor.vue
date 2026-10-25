<!--
供应商编辑面板：编辑名称、启用状态、接口类型、API 地址和 API Key，并接入模型列表与删除确认。
所有字段只通过 update:provider 交给上层写回；删除确认弹窗是本地临时状态。
控件全部使用 KIMA 的输入尺度：字段标签在上，控件在下，组与组之间留出可扫读的间距。
调用示例：<ProviderEditor :provider="selectedProvider" @update:provider="saveProvider" @delete="removeProvider" />
-->
<script setup>
import { ref } from 'vue'
import { KimaButton, KimaDialog, KimaDivider, KimaFlex, KimaSwitch, KimaTextField } from '@kernel4632/kima'
import { Select } from '../../ui/index.js'
import ProviderModels from './ProviderModels.vue'

const props = defineProps({ provider: { type: Object, required: true } })
const emit = defineEmits(['delete', 'update:provider'])

const deleteOpen = ref(false)
const API_TYPE_OPTIONS = [{ value: 'openai-compatible', label: 'OpenAI 兼容' }]
const update = patch => emit('update:provider', { ...props.provider, ...patch })
</script>

<template>
  <div class="provider-form">
    <div class="provider-field">
      <span class="provider-field__label">供应商名</span>
      <KimaTextField
        label="供应商名"
        :model-value="provider.name"
        @update:model-value="update({ name: $event })"
      />
    </div>

    <KimaSwitch
      :model-value="provider.enabled"
      @update:model-value="update({ enabled: $event })"
    >启用此供应商</KimaSwitch>

    <div class="provider-field">
      <span class="provider-field__label">接口类型</span>
      <Select
        label="接口类型"
        :model-value="provider.apiType"
        :options="API_TYPE_OPTIONS"
        @update:model-value="update({ apiType: $event })"
      />
    </div>

    <div class="provider-field">
      <span class="provider-field__label">请求地址（API）</span>
      <KimaTextField
        label="请求地址（API）"
        type="url"
        placeholder="https://api.example.com/v1"
        :model-value="provider.apiUrl"
        @update:model-value="update({ apiUrl: $event })"
      />
    </div>

    <div class="provider-field">
      <span class="provider-field__label">API Key</span>
      <KimaTextField
        label="API Key"
        type="password"
        autocomplete="off"
        placeholder="输入 API Key"
        :model-value="provider.apiKey"
        @update:model-value="update({ apiKey: $event })"
      />
    </div>

    <ProviderModels :provider="provider" :models="provider.models" @update:models="update({ models: $event })" />

    <KimaDivider />
    <KimaFlex justify="start">
      <KimaButton variant="text" class="provider-delete" @click="deleteOpen = true">删除供应商</KimaButton>
    </KimaFlex>
  </div>

  <KimaDialog
    :open="deleteOpen"
    title="删除供应商"
    description="删除后会自动保存，此供应商配置将被移除。"
    @update:open="deleteOpen = $event"
  >
    <template #footer>
      <KimaButton variant="text" @click="deleteOpen = false">取消</KimaButton>
      <KimaButton variant="text" class="provider-delete" @click="emit('delete'); deleteOpen = false">删除</KimaButton>
    </template>
  </KimaDialog>
</template>

<style scoped lang="scss">
.provider-form { display: flex; min-width: 0; flex-direction: column; gap: 28px; }
.provider-field { display: grid; gap: 8px; }
.provider-field__label {
  color: var(--kima-color-on-surface-variant);
  font-family: var(--kima-font-family);
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
.provider-delete { color: var(--kima-color-error); }
</style>
