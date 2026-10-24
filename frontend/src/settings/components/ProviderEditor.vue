<!--
供应商编辑面板：编辑名称、启用状态、接口类型、API 地址和 API Key，并接入模型列表与删除确认。
所有字段只通过 update:provider 交给上层写回；删除确认弹窗是本地临时状态。
控件全部使用 KIMA：KimaTextField、KimaSelect、KimaSwitch、KimaButton、KimaDialog。
调用示例：<ProviderEditor :provider="selectedProvider" @update:provider="saveProvider" @delete="removeProvider" />
-->
<script setup>
import { ref } from 'vue'
import { KimaButton, KimaDialog, KimaDivider, KimaFlex, KimaSelect, KimaSwitch, KimaTextField, KimaTypography } from '@kernel4632/kima'
import ProviderModels from './ProviderModels.vue'

const props = defineProps({ provider: { type: Object, required: true } })
const emit = defineEmits(['delete', 'update:provider'])

const deleteOpen = ref(false)
const API_TYPE_OPTIONS = [{ value: 'openai-compatible', label: 'OpenAI 兼容' }]
const update = patch => emit('update:provider', { ...props.provider, ...patch })
</script>

<template>
  <KimaFlex direction="column" :gap="4">
    <KimaTypography type="caption">供应商名</KimaTypography>
    <KimaTextField
      label="供应商名"
      :model-value="provider.name"
      @update:model-value="update({ name: $event })"
    />

    <KimaSwitch
      :model-value="provider.enabled"
      @update:model-value="update({ enabled: $event })"
    >启用此供应商</KimaSwitch>

    <KimaTypography type="caption">接口类型</KimaTypography>
    <KimaSelect
      label="接口类型"
      :model-value="provider.apiType"
      :items="API_TYPE_OPTIONS"
      @update:model-value="update({ apiType: $event })"
    />

    <KimaTypography type="caption">请求地址（API）</KimaTypography>
    <KimaTextField
      label="请求地址（API）"
      type="url"
      placeholder="https://api.example.com/v1"
      :model-value="provider.apiUrl"
      @update:model-value="update({ apiUrl: $event })"
    />

    <KimaTypography type="caption">API Key</KimaTypography>
    <KimaTextField
      label="API Key"
      type="password"
      autocomplete="off"
      placeholder="输入 API Key"
      :model-value="provider.apiKey"
      @update:model-value="update({ apiKey: $event })"
    />

    <ProviderModels :provider="provider" :models="provider.models" @update:models="update({ models: $event })" />
    <KimaDivider />
    <KimaFlex justify="start">
      <KimaButton variant="text" @click="deleteOpen = true">删除供应商</KimaButton>
    </KimaFlex>
  </KimaFlex>

  <KimaDialog
    :open="deleteOpen"
    title="删除供应商"
    description="删除后会自动保存，此供应商配置将被移除。"
    @update:open="deleteOpen = $event"
  >
    <template #footer>
      <KimaButton variant="text" @click="deleteOpen = false">取消</KimaButton>
      <KimaButton variant="text" @click="emit('delete'); deleteOpen = false">删除</KimaButton>
    </template>
  </KimaDialog>
</template>
