<!--
供应商编辑面板：编辑名称、启用状态、接口类型、API 地址和 API Key，并接入模型列表与删除确认。
所有字段只通过 update:provider 交给上层写回；显示 API Key 和删除确认弹窗是本地临时状态。
控件统一用 ui/ 的 Field、Select、Switch、Button；原生 dialog 暂留，等 Dialog 支持受控开关后再换。
调用示例：<ProviderEditor :provider="selectedProvider" @update:provider="saveProvider" @delete="removeProvider" />
-->
<script setup>
import { ref } from 'vue'
import { Button, Field, Select, Switch } from '../../ui/index.js'
import ProviderModels from './ProviderModels.vue'

const props = defineProps({ provider: { type: Object, required: true } })
const emit = defineEmits(['delete', 'update:provider'])

// API Key 默认隐藏，点“显示”只在当前面板内切换类型，不改动草稿里的值。
const showApiKey = ref(false)
const deleteDialog = ref(null)

// 接口类型目前只有 OpenAI 兼容一种，保留下拉框以便以后扩展。
const API_TYPE_OPTIONS = [{ value: 'openai-compatible', label: 'OpenAI 兼容' }]

// 每次只把变化的字段合并回完整供应商对象，列表顺序和未编辑字段保持不变。
const update = patch => emit('update:provider', { ...props.provider, ...patch })
</script>

<template>
  <div class="provider-editor">
    <Field
      class="provider-editor__field"
      caption="供应商名"
      label="供应商名"
      :model-value="provider.name"
      @update:model-value="update({ name: $event })"
    />
    <label class="provider-editor__enabled">
      <span>启用此供应商</span>
      <Switch
        :model-value="provider.enabled"
        label="启用此供应商"
        @update:model-value="update({ enabled: $event })"
      />
    </label>
    <Select
      class="provider-editor__field"
      caption="接口类型"
      label="接口类型"
      :model-value="provider.apiType"
      :options="API_TYPE_OPTIONS"
      @update:model-value="update({ apiType: $event })"
    />
    <Field
      class="provider-editor__field"
      caption="请求地址（API）"
      label="请求地址（API）"
      type="url"
      placeholder="https://api.example.com/v1"
      :model-value="provider.apiUrl"
      @update:model-value="update({ apiUrl: $event })"
    />
    <div class="provider-editor__secret">
      <Field
        class="provider-editor__field"
        caption="API Key"
        label="API Key"
        :type="showApiKey ? 'text' : 'password'"
        autocomplete="off"
        placeholder="输入 API Key"
        :model-value="provider.apiKey"
        @update:model-value="update({ apiKey: $event })"
      />
      <Button
        variant="ghost"
        :aria-label="showApiKey ? '隐藏 API Key' : '显示 API Key'"
        @click="showApiKey = !showApiKey"
      >{{ showApiKey ? '隐藏' : '显示' }}</Button>
    </div>
    <ProviderModels :provider="provider" :models="provider.models" @update:models="update({ models: $event })" />
    <footer><Button variant="ghost" class="provider-editor__delete" @click="deleteDialog.showModal()">删除供应商</Button></footer>
  </div>
  <dialog ref="deleteDialog" class="dialog" aria-label="删除供应商确认"><h2>删除供应商？</h2><p>保存设置后，此供应商配置将被移除。</p><div class="dialog-actions"><Button @click="deleteDialog.close()">取消</Button><Button variant="danger" @click="emit('delete')">删除</Button></div></dialog>
</template>

<style scoped lang="scss">
.provider-editor {
  display: grid; gap: 16px; min-width: 0;

  /* 多写一层 .provider-editor，压过 ui-field--labeled / ui-select--labeled 的 8px 间距。 */
  .provider-editor__field { display: grid; flex: 1; min-width: 0; gap: 6px; color: var(--la-muted); font-size: 13px; font-weight: 440; }
  /* Field / Select 的真实输入在子组件内部，用 :deep 保留原来的底色和字号。 */
  :deep(.field) { background: var(--la-layer-02); font-size: 13px; }
  /* 原生的可见标题是次要文字颜色，继续保持 muted。 */
  &__field :deep(.ui-field__caption),
  &__field :deep(.ui-select__caption) { color: var(--la-muted); }

  &__enabled { display: flex; align-items: center; justify-content: space-between; color: var(--la-secondary); font-size: 13px; }
  &__secret { display: flex; align-items: end; gap: 12px; }
  &__secret :deep(.text-button) { margin-bottom: 9px; }
  &__delete { color: var(--la-danger); }
  footer { padding-top: 12px; border-top: .5px solid var(--la-line); }
}
</style>
