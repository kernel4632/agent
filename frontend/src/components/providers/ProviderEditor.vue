<!--
供应商详情：配置、模型、高级设置三个标签页；配置使用分段表单和底部操作栏。
内容顺序参考 RikkaHub ProviderConfigure；模型页交给 ProviderModels，保存仍使用设置队列。
调用示例：<ProviderEditor :provider="selectedProvider" @update:provider="saveProvider" @delete="removeProvider" />
-->
<script setup>
import { Provider, PROVIDER_TYPES } from '../../commands/provider.js'

import { computed, ref } from 'vue'
import JsonInput from '../../ui/JsonInput.vue'
import Select from '../../ui/Select.vue'
import Tabs from '../../ui/Tabs.vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Field from '../../ui/Field.vue'
import Switch from '../../ui/Switch.vue'
import ProviderModels from './ProviderModels.vue'
import { Settings } from '../../commands/settings.js'

const props = defineProps({ provider: { type: Object, required: true } })
const emit = defineEmits(['delete', 'update:provider'])

const tab = ref('config')
const deleteOpen = ref(false)
const testing = ref(false)
const saving = ref(false)
const testState = ref(null)
const tabs = [
  { value: 'config', label: '配置' },
  { value: 'models', label: '模型' },
  { value: 'advanced', label: '高级设置' },
]

const type = computed(() => PROVIDER_TYPES.find(item => item.value === props.provider.apiType))

async function saveConfig() {
  saving.value = true
  try {
    const ok = await Settings.autoSave()
    testState.value = { ok, text: ok ? '配置已保存' : '保存失败，请检查填写内容' }
  } finally { saving.value = false }
}

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
    // 还没输入完整；JsonInput 自己会显示错误位置。
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
    const result = await Provider.testConnection(name, model)
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
    <div class="provider-form__meta"><span>{{ type.label }}</span><small>修改后自动保存</small></div>
    <Tabs v-model="tab" :items="tabs">
      <template #panel="{ item }">
        <section v-if="item.value === 'config'" class="provider-tab provider-config" aria-label="供应商配置">
          <div class="provider-group">
            <div class="provider-group__item provider-group__toggle">
              <Switch :model-value="provider.enabled" label="启用此供应商" @update:model-value="update({ enabled: $event })" />
            </div>
          </div>

          <section class="provider-section" aria-label="连接设置">
            <h2>连接设置</h2>
            <div class="provider-group">
              <div class="provider-group__item"><Field caption="供应商名" label="供应商名" :model-value="provider.name" clearable @update:model-value="update({ name: $event })" /></div>
              <div class="provider-group__item"><Field caption="API Key" label="API Key" type="password" autocomplete="off" placeholder="输入 API Key" :model-value="provider.apiKey" @update:model-value="update({ apiKey: $event })" /></div>
              <div class="provider-group__item"><Field caption="API 地址" label="请求地址（API）" type="url" :placeholder="type.url" :model-value="provider.apiUrl" @update:model-value="update({ apiUrl: $event })" /></div>
            </div>
          </section>

          <section class="provider-section" aria-label="请求选项">
            <h2>请求选项</h2>
            <div class="provider-group">
              <div class="provider-group__item provider-protocol">
                <div><span>接口类型</span><small>与模型服务提供的接口一致</small></div>
                <Select label="接口类型" :model-value="provider.apiType" :items="PROVIDER_TYPES" @update:model-value="update({ apiType: $event })" />
              </div>
              <div class="provider-group__item provider-group__toggle">
                <Switch :model-value="provider.stream !== false" label="流式输出：回复边生成边显示" @update:model-value="update({ stream: $event })" />
              </div>
            </div>
          </section>
        </section>

        <section v-else-if="item.value === 'models'" class="provider-tab provider-tab--models">
          <ProviderModels :provider="provider" :models="provider.models" @update:models="update({ models: $event })" />
        </section>

        <section v-else class="provider-tab provider-advanced" aria-label="供应商高级设置">
          <section class="provider-section">
            <h2>自定义请求头</h2>
            <div class="provider-group"><div class="provider-group__item">
              <p class="provider-field__hint">随每次请求发送，例如 <code>{"X-Title": "la"}</code></p>
              <JsonInput :model-value="provider.headers ?? ''" label="自定义请求头" :rows="5" @change="setJson('headers', $event)" />
            </div></div>
          </section>
          <section class="provider-section">
            <h2>额外请求体</h2>
            <div class="provider-group"><div class="provider-group__item">
              <p class="provider-field__hint">补充模型参数，例如 <code>{"temperature": 0.7}</code></p>
              <JsonInput :model-value="provider.body ?? ''" label="额外请求体" :rows="5" @change="setJson('body', $event)" />
            </div></div>
          </section>
        </section>
      </template>
    </Tabs>
    <div v-if="tab === 'config'" class="provider-actions-wrap">
      <p v-if="testState" class="provider-test__result" :class="{ 'is-error': !testState.ok }" role="status">{{ testState.text }}</p>
      <div class="provider-actions" aria-label="供应商操作">
        <Button icon variant="text" label="删除供应商" class="provider-delete" @click="deleteOpen = true"><Icon name="trash" /></Button>
        <Button variant="text" :disabled="testing || saving" @click="testConnection"><Icon name="play" :size="18" />{{ testing ? '测试中…' : '测试连接' }}</Button>
        <Button :disabled="testing || saving" @click="saveConfig"><Icon name="check" :size="18" />{{ saving ? '保存中…' : '保存配置' }}</Button>
      </div>
    </div>
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

<style scoped lang="scss" src="../../styles/components/providers/ProviderEditor.scss"></style>
