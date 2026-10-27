<!--
对话设置抽屉：模型能力、模型分工和上下文限制。
权限和智能体已经拆成独立的底部抽屉；这里只放不常改的模型与上下文选项。
调用示例：<ConversationSettingsDrawer :open="open" :session="session" @update:open="open = $event" />
-->
<script setup>
import { computed } from 'vue'
import { KimaDrawer, KimaSelect } from '@kernel4632/kima'
import { Field, Switch } from '../ui/index.js'
import { Session, USE_LABELS } from '../commands/session.js'
import { store } from '../store.js'

const props = defineProps({
  open: Boolean,
  session: { type: Object, required: true },
})
const emit = defineEmits(['update:open'])

const allModels = () => Object.entries(store.config.providers || {})
  .flatMap(([provider, entry]) => (entry.models || []).map(model => ({ provider, model })))
const useModelOptions = computed(() => [
  { value: '', label: '和主模型共用' },
  ...allModels().map(item => ({ value: `${item.provider}/${item.model}`, label: `${item.provider} / ${item.model}` })),
])
const useKey = use => {
  const target = props.session.settings.uses?.[use]
  return target ? `${target.provider}/${target.model}` : ''
}
const targetFrom = value => {
  if (!value) return null
  const [provider, ...rest] = value.split('/')
  return { provider, model: rest.join('/') }
}

const capabilityRows = [
  { key: 'image', label: '图像' },
  { key: 'cache', label: '缓存' },
  { key: 'stream', label: '流式' },
]

function toggleCapability(key) {
  void Session.toggleCapability(props.session.id, key)
}
</script>

<template>
  <KimaDrawer
    class="conversation-settings"
    :open="open"
    title="模型与上下文"
    placement="right"
    @update:open="emit('update:open', $event)"
  >
    <div class="conversation-settings__body">
      <p class="conversation-settings__lead">这段对话的模型能力、模型分工和上下文限制。权限和智能体已经拆到输入框旁的独立入口。</p>

      <section class="conversation-settings__section">
        <h3>模型能力</h3>
        <p>按模型提供的实际能力开关。</p>
        <div class="conversation-settings__switches">
          <Switch v-for="item in capabilityRows" :key="item.key" :model-value="session.settings.capabilities[item.key]" :label="item.label" @update:model-value="toggleCapability(item.key)" />
          <Switch :model-value="session.settings.autoTitle" label="自动标题" @update:model-value="Session.toggleAutoTitle(session.id)" />
        </div>
      </section>

      <section class="conversation-settings__section">
        <h3>哪件事用哪个模型</h3>
        <p>不选就和主模型（{{ session.model }}）共用。</p>
        <div class="conversation-settings__fields">
          <label v-for="(label, use) in USE_LABELS" :key="use" class="conversation-settings__field">
            <span>{{ label }}</span>
            <KimaSelect :label="label" :model-value="useKey(use)" :items="useModelOptions" @update:model-value="Session.setUse(session.id, use, targetFrom($event))" />
          </label>
        </div>
      </section>

      <section class="conversation-settings__section">
        <h3>上限与压缩</h3>
        <p>连着自动批准太多次就停下来问一句；上下文用到阈值时自动总结。</p>
        <div class="conversation-settings__fields">
          <Field size="small" caption="自动批准连续次数（0 表示不设上限）" type="number" label="连续次数" min="0" :model-value="session.settings.autoApproveLimit" @change="Session.setLimit(session.id, Number($event))" />
          <Field size="small" caption="自动压缩阈值（0.1 到 0.99）" type="number" label="阈值" min="0.1" max="0.99" step="0.05" :model-value="session.settings.compactThreshold ?? 0.8" @change="Session.setCompactThreshold(session.id, Number($event))" />
        </div>
      </section>
    </div>
  </KimaDrawer>
</template>

<style scoped lang="scss">
.conversation-settings { --kima-drawer-max-width: 380px; }
.conversation-settings__body { display: flex; min-width: 0; flex-direction: column; gap: 26px; padding-bottom: 12px; }
.conversation-settings__lead { margin: 0; color: var(--la-secondary); font-size: 14px; line-height: 22px; }
.conversation-settings__section { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
.conversation-settings__section h3 { margin: 0; color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; }
.conversation-settings__section > p { margin: 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.conversation-settings__section > p code { font-family: var(--la-font-mono); }
.conversation-settings__switches { display: flex; flex-direction: column; gap: 4px; }
.conversation-settings__switches :deep(.kima-switch) { width: 100%; min-height: 52px; padding: 0 16px; border-radius: 14px; background: var(--la-layer-01); }
.conversation-settings__fields { display: flex; flex-direction: column; gap: 14px; }
.conversation-settings__field { display: flex; flex-direction: column; gap: 6px; color: var(--la-secondary); font-size: 13px; line-height: 18px; }
</style>
