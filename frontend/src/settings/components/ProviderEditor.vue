<!--
供应商编辑页：配置、模型、高级设置三个标签页。
配置页管名称、启用、协议、地址、密钥、流式输出和连接测试；模型页交给 ProviderModels；
高级页放自定义请求头和额外请求体。所有字段只通过 update:provider 交给上层，弹窗状态留在本地。
调用示例：<ProviderEditor :provider="selectedProvider" @update:provider="saveProvider" @delete="removeProvider" />
-->
<script setup>
import { computed, ref } from 'vue'
import {
  KimaJsonInput, KimaSelect, KimaTabs,
} from '@kernel4632/kima'
import { AppIcon, Button, Dialog, Field, Switch } from '../../ui/index.js'
import ProviderModels from './ProviderModels.vue'
import { Config } from '../../commands/config.js'
import { Settings } from '../../commands/settings.js'

const props = defineProps({ provider: { type: Object, required: true } })
const emit = defineEmits(['delete', 'update:provider'])

const tab = ref('config')
const deleteOpen = ref(false)
const testing = ref(false)
const testState = ref(null)
const tabs = [
  { value: 'config', label: '配置' },
  { value: 'models', label: '模型' },
  { value: 'advanced', label: '高级设置' },
]

// 后端只认这四种协议；名称按各家接口文档的常用说法写，不自己造缩写。
const API_TYPES = [
  { value: 'openai-compatible', label: 'OpenAI 兼容' },
  { value: 'responses', label: 'OpenAI Responses' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
]
const URL_HINTS = {
  'openai-compatible': 'https://api.example.com/v1',
  responses: 'https://api.example.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}
const urlHint = computed(() => URL_HINTS[props.provider.apiType] || URL_HINTS['openai-compatible'])

function update(patch) {
  testState.value = null
  emit('update:provider', { ...props.provider, ...patch })
}

// JSON 框只在完整且是对象时写回草稿；输入到一半的文本留在框里，不触发自动保存。
function setJson(field, value) {
  const text = String(value || '').trim()
  if (!text) { update({ [field]: '' }); return }
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) update({ [field]: text })
  } catch {
    // 还没输入完整；KimaJsonInput 自己会显示错误位置。
  }
}

async function testConnection() {
  const name = props.provider.name.trim()
  const model = props.provider.models?.[0]?.id || ''
  if (!name) { testState.value = { ok: false, text: '先填写供应商名。' }; return }
  if (!model) { testState.value = { ok: false, text: '先添加一个模型，测试要用它发一次请求。' }; return }
  testing.value = true
  testState.value = null
  try {
    // 测试读的是服务端已保存的配置，所以先把当前草稿落盘。
    if (!await Settings.autoSave()) { testState.value = { ok: false, text: '保存失败，先处理配置里的错误。' }; return }
    const result = await Config.testConnection(name, model)
    testState.value = result.ok
      ? { ok: true, text: `连接成功：${result.text || '模型有回复'}` }
      : { ok: false, text: result.error || '连接失败' }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="provider-form">
    <KimaTabs v-model="tab" :items="tabs">
      <template #panel="{ item }">
        <section v-if="item.value === 'config'" class="provider-tab" aria-label="供应商配置">
          <Field caption="供应商名" label="供应商名" :model-value="provider.name" clearable @update:model-value="update({ name: $event })" />

          <Switch :model-value="provider.enabled" label="启用此供应商" @update:model-value="update({ enabled: $event })" />

          <div class="provider-field">
            <span class="provider-field__label">接口类型</span>
            <KimaSelect label="接口类型" :model-value="provider.apiType" :items="API_TYPES" @update:model-value="update({ apiType: $event })" />
            <p class="provider-field__hint">换类型不会自动改地址；地址按对应服务的接口文档填写。</p>
          </div>

          <Field
            caption="请求地址（API）"
            label="请求地址（API）"
            type="url"
            :placeholder="urlHint"
            :model-value="provider.apiUrl"
            @update:model-value="update({ apiUrl: $event })"
          />

          <Field
            caption="API Key"
            label="API Key"
            type="password"
            autocomplete="off"
            placeholder="输入 API Key"
            :model-value="provider.apiKey"
            hint="保存后只发给这个供应商；右侧眼睛按钮可以临时查看。"
            @update:model-value="update({ apiKey: $event })"
          />

          <Switch :model-value="provider.stream !== false" label="流式输出：回复边生成边显示" @update:model-value="update({ stream: $event })" />

          <div class="provider-test">
            <div class="provider-test__actions">
              <Button variant="tonal" :disabled="testing" @click="testConnection">
                <AppIcon name="play" :size="18" />
                <span>{{ testing ? '正在测试…' : '测试连接' }}</span>
              </Button>
              <span class="provider-test__note">用列表里的第一个模型发一句很短的话。</span>
            </div>
            <p v-if="testState" class="provider-test__result" :class="{ 'is-error': !testState.ok }" role="status">{{ testState.text }}</p>
          </div>

          <div class="provider-danger">
            <Button variant="text" class="provider-delete" @click="deleteOpen = true">
              <AppIcon name="trash" :size="18" />
              <span>删除供应商</span>
            </Button>
            <span>删除后会自动保存，这个供应商的模型和地址都会一起移除。</span>
          </div>
        </section>

        <section v-else-if="item.value === 'models'" class="provider-tab">
          <ProviderModels :provider="provider" :models="provider.models" @update:models="update({ models: $event })" />
        </section>

        <section v-else class="provider-tab" aria-label="供应商高级设置">
          <div class="provider-field">
            <span class="provider-field__label">自定义请求头</span>
            <KimaJsonInput :model-value="provider.headers ?? ''" label="自定义请求头" :rows="4" @change="setJson('headers', $event)" />
            <p class="provider-field__hint">写成一个 JSON 对象，例如 <code>{"X-Title": "la"}</code>；会合并进每次模型请求。</p>
          </div>

          <div class="provider-field">
            <span class="provider-field__label">额外请求体</span>
            <KimaJsonInput :model-value="provider.body ?? ''" label="额外请求体" :rows="4" @change="setJson('body', $event)" />
            <p class="provider-field__hint">写成一个 JSON 对象，例如温度、top_p；这些字段会原样合并进请求体。</p>
          </div>

          <p class="provider-advanced__note">高级字段会直接发给供应商。不确定含义时保持为空，避免覆盖模型需要的参数。</p>
        </section>
      </template>
    </KimaTabs>
  </div>

  <Dialog
    :open="deleteOpen"
    label="删除供应商"
    @update:open="deleteOpen = $event"
  >
    <p class="provider-dialog__text">删除后会自动保存，此供应商配置将被移除。</p>
    <template #footer>
      <Button variant="text" @click="deleteOpen = false">取消</Button>
      <Button variant="text" class="provider-delete" @click="emit('delete'); deleteOpen = false">删除</Button>
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.provider-form { display: flex; min-width: 0; flex-direction: column; }
.provider-tab {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 24px;
  margin-top: 12px;
  padding: 22px;
  border-radius: 20px;
  background: var(--la-layer-01);
}
.provider-field { display: grid; gap: 8px; min-width: 0; }
.provider-field > * { min-width: 0; max-width: 100%; }
.provider-field__label { color: var(--kima-color-on-surface-variant); font-size: 14px; font-weight: 500; line-height: 20px; }
.provider-field__hint { margin: 0; color: var(--la-muted); font-size: 12.5px; line-height: 18px; }
.provider-field__hint code { font-family: var(--la-font-mono); }
.provider-dialog__text { margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
.provider-test { display: grid; gap: 10px; padding: 16px; border-radius: 16px; background: var(--la-layer-02); }
.provider-test__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.provider-test__note { color: var(--la-muted); font-size: 12.5px; line-height: 18px; }
.provider-test__result { margin: 0; color: var(--la-success); font-size: 13px; line-height: 20px; }
.provider-test__result.is-error { color: var(--kima-color-error); }
.provider-danger { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding-top: 4px; }
.provider-danger span { flex: 1 1 220px; color: var(--la-muted); font-size: 12.5px; line-height: 18px; }
.provider-delete { color: var(--kima-color-error); }
.provider-advanced__note { margin: 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
@media (max-width: 767px) {
  .provider-tab { padding: 18px; }
}
</style>
