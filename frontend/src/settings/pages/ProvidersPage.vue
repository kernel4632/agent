<!--
模型供应商页：默认是供应商列表；点一行进入该供应商的编辑页。
列表和编辑页共用 draft.providers，保存仍由设置页自动完成。
调用示例：<ProvidersPage :draft="draft" :detail="detail" @open-detail="..." @close-detail="..." @update-detail-title="..." />
-->
<script setup>
import { computed } from 'vue'
import { Button } from '../../ui/index.js'
import ProviderEditor from '../components/ProviderEditor.vue'
import ProviderList from '../components/ProviderList.vue'

const props = defineProps({
  draft: { type: Object, required: true },
  detail: { type: Object, default: null },
})
const emit = defineEmits(['open-detail', 'close-detail', 'update-detail-title'])

const selected = computed(() => props.detail
  ? props.draft.providers.find(item => item.id === props.detail.id) ?? null
  : null)

function addProvider() {
  const providers = props.draft.providers
  let number = providers.length + 1
  while (providers.some(item => item.name === `Provider ${number}`)) number += 1
  const provider = { id: crypto.randomUUID(), name: `Provider ${number}`, enabled: true, apiType: 'openai-compatible', apiUrl: '', apiKey: '', stream: undefined, headers: '{}', body: '{}', models: [] }
  providers.push(provider)
  emit('open-detail', { id: provider.id, title: provider.name })
}

function updateProvider(updated) {
  const providers = props.draft.providers
  const index = providers.findIndex(item => item.id === updated.id)
  if (index < 0) return
  providers[index] = updated
  if (props.detail?.id === updated.id) emit('update-detail-title', updated.name)
}

function removeProvider() {
  const providers = props.draft.providers
  const index = providers.findIndex(item => item.id === props.detail?.id)
  if (index >= 0) providers.splice(index, 1)
  emit('close-detail')
}
</script>

<template>
  <ProviderList
    v-if="!detail"
    :providers="draft.providers"
    @select="provider => emit('open-detail', { id: provider.id, title: provider.name })"
    @add="addProvider"
  />

  <div v-else-if="selected" :key="selected.id" class="provider-detail">
    <ProviderEditor
      :provider="selected"
      @update:provider="updateProvider"
      @delete="removeProvider"
    />
  </div>

  <div v-else class="provider-missing">
    <p>这个供应商已经不存在了。</p>
    <Button @click="emit('close-detail')">返回供应商列表</Button>
  </div>
</template>

<style scoped lang="scss">
.provider-detail { display: block; }
.provider-missing { display: grid; justify-items: start; gap: 16px; padding: 24px; border-radius: 20px; background: var(--la-layer-01); }
.provider-missing p { margin: 0; color: var(--la-muted); font-size: 14px; }
</style>
