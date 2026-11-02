<!--
模型设置页：对话、压缩、标题和子任务的模型统一写入 config.models。
模型能力在供应商的模型编辑页设置；这里仅选择每件事使用哪个模型。
调用示例：<ModelSettings :draft="draft" />
-->
<script setup>
import { computed } from 'vue'
import Select from '../../ui/Select.vue'
import { store } from '../../store.js'

const props = defineProps({ draft: { type: Object, required: true } })

const modelOptions = computed(() => {
  const options = []
  for (const provider of props.draft.providers || []) {
    for (const model of provider.models || []) {
      options.push({ value: JSON.stringify({ provider: provider.name, model: model.id }), label: `${provider.name} / ${model.name || model.id}` })
    }
  }
  return options
})
const modelChoices = computed(() => [{ value: '', label: '和默认模型共用' }, ...modelOptions.value])
const tasks = computed(() => store.config.modelTasks.filter(item => item.task !== 'chat'))

function modelValue(task) {
  const target = props.draft.models[task]
  return target?.provider && target?.model ? JSON.stringify(target) : ''
}

function chooseModel(task, value) {
  props.draft.models[task] = value ? JSON.parse(value) : { provider: '', model: '' }
}
</script>

<template>
  <section class="model-settings" aria-label="模型">
    <header class="model-settings__head">
      <p>默认模型用于新对话；已有对话可以在输入框旁单独切换。压缩、标题和子任务的模型在这里统一选择。</p>
    </header>

    <div class="model-settings__section">
      <div class="model-settings__intro">
        <h3>默认模型</h3>
        <p>新对话开始时就使用这个模型。</p>
      </div>
      <div class="model-settings__field">
        <span class="model-settings__label">模型</span>
        <Select label="默认模型" :model-value="modelValue('chat')" :items="[{ value: '', label: '使用首个可用模型' }, ...modelOptions]" @update:model-value="chooseModel('chat', $event)" />
      </div>
      <p v-if="!modelOptions.length" class="model-settings__empty">还没有可用模型。先在「模型供应商」里添加一个供应商和模型。</p>
    </div>

    <div class="model-settings__section">
      <div class="model-settings__intro">
        <h3>哪件事用哪个模型</h3>
        <p>不选就和默认模型共用；只有确实需要更便宜或更快的模型时才分开。</p>
      </div>
      <div class="model-settings__fields">
        <div class="model-settings__field" v-for="item in tasks" :key="item.task">
          <span class="model-settings__label">{{ item.label }}</span>
          <Select :label="item.label" :model-value="modelValue(item.task)" :items="modelChoices" @update:model-value="chooseModel(item.task, $event)" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/providers/ModelSettings.scss"></style>
