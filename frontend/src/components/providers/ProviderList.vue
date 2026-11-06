<!--
模型供应商页：搜索与卡片列表，添加时先选接口类型，再进入配置详情。
布局参考 RikkaHub SettingProviderPage；列表和编辑页共用 draft.providers。
调用示例：<ProviderList :draft="draft" :detail="detail" @open-detail="..." @close-detail="..." @update-detail-title="..." />
-->
<script setup>
import { computed, ref } from 'vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Field from '../../ui/Field.vue'
import { Provider, PROVIDER_TYPES } from "../../features/settings.js"
import ProviderEditor from './ProviderEditor.vue'

const props = defineProps({
  draft: { type: Object, required: true },
  detail: { type: Object, default: null },
})
const emit = defineEmits(['open-detail', 'close-detail', 'update-detail-title'])
const search = ref('')
const addOpen = ref(false)
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return props.draft.providers.filter(provider => `${provider.name} ${provider.apiUrl}`.toLowerCase().includes(query))
})
const typeLabel = type => PROVIDER_TYPES.find(item => item.value === type)?.label || type

const selected = computed(() => props.detail
  ? props.draft.providers.find(item => item.id === props.detail.id) ?? null
  : null)

function addProvider(type) {
  const providers = props.draft.providers
  const provider = Provider.createDraft(type, providers)
  providers.unshift(provider)
  search.value = ''
  addOpen.value = false
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
      <Field v-model="search" type="search" label="搜索供应商" placeholder="搜索供应商" clearable>
        <template #leading><Icon name="search" /></template>
      </Field>
      <Button icon variant="tonal" label="添加供应商" class="provider-list__add" @click="addOpen = true"><Icon name="plus" :size="24" /></Button>
    </header>
    <p class="provider-list__count">{{ search.trim() ? `找到 ${filtered.length} 个供应商` : `${draft.providers.length} 个供应商` }}</p>

    <div v-if="filtered.length" class="provider-list__cards">
      <Button
        v-for="provider in filtered"
        :key="provider.id"
        variant="plain"
        class="provider-row"
        :class="{ 'is-disabled': !provider.enabled }"
        @click="emit('open-detail', { id: provider.id, title: provider.name })"
      >
        <span class="provider-row__icon" aria-hidden="true"><Icon name="globe" :size="24" /></span>
        <span class="provider-row__copy">
          <strong>{{ provider.name }}</strong>
          <small>{{ provider.apiUrl || typeLabel(provider.apiType) }}</small>
          <span class="provider-row__tags">
            <span class="provider-row__state" :class="{ 'is-on': provider.enabled }">{{ provider.enabled ? '已启用' : '已停用' }}</span>
            <span>{{ typeLabel(provider.apiType) }}</span><span>{{ provider.models.length }} 个模型</span>
          </span>
        </span>
        <Icon name="arrow" :size="16" class="provider-row__arrow" aria-hidden="true" />
      </Button>
    </div>

    <div v-else class="provider-list__empty">
      <Icon :name="search.trim() ? 'search' : 'globe'" :size="36" />
      <strong>{{ search.trim() ? '没有找到供应商' : '连接你的第一个模型服务' }}</strong>
      <p>{{ search.trim() ? '换一个名称或地址试试' : '选择接口类型，再填写地址和密钥' }}</p>
      <Button v-if="search.trim()" variant="text" @click="search = ''">清除搜索</Button>
    </div>
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

  <Dialog :open="addOpen" placement="bottom" :width="560" label="添加供应商" class="provider-type-sheet" @update:open="addOpen = $event">
    <p class="provider-type-hint">选择模型服务使用的接口类型</p>
    <div class="provider-type-list">
      <button v-for="type in PROVIDER_TYPES" :key="type.value" type="button" class="provider-type-row" @click="addProvider(type.value)">
        <span class="provider-type-row__icon"><Icon name="globe" :size="24" /></span>
        <span><strong>{{ type.label }}</strong><small>{{ type.hint }}</small></span>
        <Icon name="arrow" :size="18" />
      </button>
    </div>
  </Dialog>
</template>

<style scoped lang="scss" src="../../styles/components/providers/ProviderList.scss"></style>
