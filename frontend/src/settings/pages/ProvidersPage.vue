<!--
模型供应商页包装：只负责把设置草稿的 providers 字段接到 ProviderSettings。
“管理模型连接 / 添加供应商”这一行属于本页；新增供应商只改 draft.providers，保存由设置页底部触发。
调用示例：<ProvidersPage :draft="draft" />，由 SettingsPage 按登记表动态渲染。
-->
<script setup>
import AppIcon from '../../components/AppIcon.vue'
import Button from '../../ui/Button.vue'
import ProviderSettings from '../../components/settings/ProviderSettings.vue'

const props = defineProps({ draft: { type: Object, required: true } })

// 找第一个没被占用的默认名称，避免新增后出现两个同名供应商。
function addProvider() {
  const providers = props.draft.providers
  let number = providers.length + 1
  while (providers.some(item => item.name === `Provider ${number}`)) number += 1
  providers.push({ id: crypto.randomUUID(), name: `Provider ${number}`, enabled: true, apiType: 'openai-compatible', apiUrl: '', apiKey: '', models: [] })
}
</script>

<template>
  <div class="settings-provider-note"><span>管理模型连接</span><Button @click="addProvider"><AppIcon name="plus" :size="14" />添加供应商</Button></div>
  <ProviderSettings v-model:providers="draft.providers" />
</template>

<style scoped lang="scss">
.settings-provider-note { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--la-muted); font-size: 13px; }
</style>
