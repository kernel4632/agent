<!--
模型供应商页：默认是供应商列表；点一行进入该供应商的编辑页。
列表和编辑页共用 draft.providers，保存仍由设置页自动完成。
调用示例：<ProviderList :draft="draft" :detail="detail" @open-detail="..." @close-detail="..." @update-detail-title="..." />
-->
<script setup>
import { computed } from 'vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import ProviderEditor from './ProviderEditor.vue'

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
  const provider = { id: crypto.randomUUID(), name: `Provider ${number}`, enabled: true, apiType: 'openai-compatible', apiUrl: '', apiKey: '', stream: true, headers: '{}', body: '{}', models: [] }
  providers.push(provider)
  emit('open-detail', { id: provider.id, title: provider.name })
}

function updateProvider(updated) {
  const providers = props.draft.providers
  const index = providers.findIndex(item => item.id === updated.id)
  if (index < 0) return
  // 改名或移除模型后，任务模型的指向也跟着更新，保存后不会指向已不存在的供应商。
  for (const target of Object.values(props.draft.models)) {
    if (target.provider !== providers[index].name) continue
    target.provider = updated.name
    if (!updated.models.some(model => model.id === target.model)) Object.assign(target, { provider: '', model: '' })
  }
  providers[index] = updated
  if (props.detail?.id === updated.id) emit('update-detail-title', updated.name)
}

function removeProvider() {
  const providers = props.draft.providers
  const index = providers.findIndex(item => item.id === props.detail?.id)
  for (const target of Object.values(props.draft.models)) {
    if (target.provider === providers[index]?.name) Object.assign(target, { provider: '', model: '' })
  }
  if (index >= 0) providers.splice(index, 1)
  emit('close-detail')
}
</script>

<template>
  <section v-if="!detail" class="provider-list" aria-label="模型供应商">
    <header class="provider-list__head">
      <p>连接模型服务，管理每个供应商下的可用模型。</p>
      <Button @click="addProvider()"><Icon name="plus" :size="18" />添加供应商</Button>
    </header>

    <div v-if="draft.providers.length" class="provider-list__card">
      <Button
        v-for="provider in draft.providers"
        :key="provider.id"
        variant="plain"
        class="provider-row"
        @click="emit('open-detail', { id: provider.id, title: provider.name })"
      >
        <span class="provider-row__icon" aria-hidden="true"><Icon name="globe" :size="20" /></span>
        <span class="provider-row__copy">
          <strong>{{ provider.name }}</strong>
          <small>{{ provider.apiUrl || '未填写请求地址' }} · {{ provider.models.length }} 个模型</small>
        </span>
        <span class="provider-row__state" :class="{ 'is-on': provider.enabled }">{{ provider.enabled ? '已启用' : '已停用' }}</span>
        <Icon name="arrow" :size="16" class="provider-row__arrow" aria-hidden="true" />
      </Button>
    </div>

    <p v-else class="provider-list__empty">还没有供应商。先添加一个模型服务。</p>
  </section>

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

<style scoped lang="scss" src="../../styles/components/providers/ProviderList.scss"></style>
