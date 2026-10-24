<!--
模型供应商页包装：只负责把设置草稿的 providers 字段接到 ProviderSettings。
“管理模型连接 / 添加供应商”这一行属于本页；新增供应商只改 draft.providers，保存由设置页自动完成。
控件全部使用 KIMA：KimaFlex、KimaTypography、KimaButton。
-->
<script setup>
import { KimaButton, KimaFlex, KimaIcon, KimaTypography } from '@kernel4632/kima'
import { Add01Icon } from '@hugeicons/core-free-icons'
import ProviderSettings from '../components/ProviderSettings.vue'

const props = defineProps({ draft: { type: Object, required: true } })

function addProvider() {
  const providers = props.draft.providers
  let number = providers.length + 1
  while (providers.some(item => item.name === `Provider ${number}`)) number += 1
  providers.push({ id: crypto.randomUUID(), name: `Provider ${number}`, enabled: true, apiType: 'openai-compatible', apiUrl: '', apiKey: '', models: [] })
}
</script>

<template>
  <KimaFlex justify="space-between" align="center" :gap="3">
    <KimaTypography type="caption">管理模型连接</KimaTypography>
    <KimaButton variant="tonal" @click="addProvider">
      <template #leading><KimaIcon :icon="Add01Icon" :size="14" /></template>
      添加供应商
    </KimaButton>
  </KimaFlex>
  <ProviderSettings v-model:providers="draft.providers" />
</template>
