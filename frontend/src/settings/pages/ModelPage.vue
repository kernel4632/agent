<!--
模型设置页：默认模型、模型能力和任务分工都持久化到全局配置。
这些值作为新对话的默认值；已有对话仍保留自己的设置。
调用示例：<ModelPage :draft="draft" />
-->
<script setup>
import { computed } from 'vue'
import { KimaSelect } from '@kernel4632/kima'
import { Switch } from '../../ui/index.js'
import { USE_LABELS } from '../../commands/session.js'

const props = defineProps({ draft: { type: Object, required: true } })

const modelOptions = computed(() => {
  const options = []
  for (const provider of props.draft.providers || []) {
    for (const model of provider.models || []) {
      const id = typeof model === 'string' ? model : model?.id || model?.name
      if (id) options.push({ value: `${provider.name}/${id}`, label: `${provider.name} / ${id}` })
    }
  }
  return options
})
const modelValue = computed(() => {
  const target = props.draft.defaultModel
  return target?.provider && target?.model ? `${target.provider}/${target.model}` : ''
})
const useOptions = computed(() => [{ value: '', label: '和默认模型共用' }, ...modelOptions.value])

const capabilityRows = [
  { key: 'image', label: '图像', hint: '允许把图片发给模型' },
  { key: 'cache', label: '缓存', hint: '命中提示词缓存时省时间和费用' },
  { key: 'stream', label: '流式', hint: '回复边生成边显示' },
]

function chooseModel(value) {
  if (!value) {
    props.draft.defaultModel = { provider: '', model: '' }
    return
  }
  const index = value.indexOf('/')
  props.draft.defaultModel = { provider: value.slice(0, index), model: value.slice(index + 1) }
}

function toggleCapability(key, value) {
  props.draft.capabilities = { ...props.draft.capabilities, [key]: value }
}

function useKey(use) {
  const target = props.draft.uses?.[use]
  return target?.provider && target?.model ? `${target.provider}/${target.model}` : ''
}

function setUse(use, value) {
  const uses = { ...(props.draft.uses || {}) }
  if (!value) delete uses[use]
  else {
    const index = value.indexOf('/')
    uses[use] = { provider: value.slice(0, index), model: value.slice(index + 1) }
  }
  props.draft.uses = uses
}
</script>

<template>
  <section class="model-settings" aria-label="模型">
    <header class="model-settings__head">
      <p>默认模型用于新对话；已有对话可以在输入框旁单独切换。能力开关和任务分工也会作为新对话的默认值。</p>
    </header>

    <div class="model-settings__section">
      <div class="model-settings__intro">
        <h3>默认模型</h3>
        <p>新对话开始时就使用这个模型。</p>
      </div>
      <div class="model-settings__field">
        <span class="model-settings__label">模型</span>
        <KimaSelect label="默认模型" :model-value="modelValue" :items="modelOptions" @update:model-value="chooseModel" />
      </div>
      <p v-if="!modelOptions.length" class="model-settings__empty">还没有可用模型。先在「模型供应商」里添加一个供应商和模型。</p>
    </div>

    <div class="model-settings__section">
      <div class="model-settings__intro">
        <h3>模型能力</h3>
        <p>按模型实际提供的能力开关；不确定时保持默认。</p>
      </div>
      <div class="model-settings__switches">
        <Switch
          v-for="item in capabilityRows"
          :key="item.key"
          :model-value="draft.capabilities[item.key]"
          :label="item.label"
          @update:model-value="toggleCapability(item.key, $event)"
        />
        <p class="model-settings__hint">{{ capabilityRows.map(item => `${item.label}：${item.hint}`).join('；') }}。</p>
      </div>
      <div class="model-settings__switches">
        <Switch :model-value="draft.autoTitle" label="自动标题" @update:model-value="draft.autoTitle = $event" />
        <p class="model-settings__hint">第一次聊完让模型给会话起一个短标题。</p>
      </div>
    </div>

    <div class="model-settings__section">
      <div class="model-settings__intro">
        <h3>哪件事用哪个模型</h3>
        <p>不选就和默认模型共用；只有确实需要更便宜或更快的模型时才分开。</p>
      </div>
      <div class="model-settings__fields">
        <div class="model-settings__field" v-for="(label, use) in USE_LABELS" :key="use">
          <span class="model-settings__label">{{ label }}</span>
          <KimaSelect :label="label" :model-value="useKey(use)" :items="useOptions" @update:model-value="setUse(use, $event)" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.model-settings { display: flex; flex-direction: column; gap: 20px; }
.model-settings__head p { margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
.model-settings__section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
  border-radius: 20px;
  background: var(--la-layer-01);
}
.model-settings__intro { display: flex; flex-direction: column; gap: 6px; }
.model-settings__intro h3 { margin: 0; color: var(--la-text); font-size: 16px; font-weight: 600; line-height: 24px; }
.model-settings__intro p { margin: 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.model-settings__field { display: flex; flex-direction: column; gap: 8px; }
.model-settings__label { color: var(--kima-color-on-surface-variant); font-size: 14px; font-weight: 500; line-height: 20px; }
.model-settings__fields { display: flex; flex-direction: column; gap: 16px; }
.model-settings__switches { display: flex; flex-direction: column; gap: 4px; }
.model-settings__switches :deep(.kima-switch) { width: 100%; min-height: 52px; padding: 0 16px; border-radius: 14px; background: var(--la-layer-02); }
.model-settings__hint { margin: 4px 2px 0; color: var(--la-muted); font-size: 12.5px; line-height: 18px; }
.model-settings__empty { margin: 0; color: var(--la-muted); font-size: 13px; line-height: 20px; }
@media (max-width: 767px) {
  .model-settings__section { padding: 18px; }
}
</style>
