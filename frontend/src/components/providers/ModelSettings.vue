<!--
模型设置页：对话、压缩、标题、子任务和工具审核的模型统一写入 config.models。
模型能力在供应商的模型编辑页设置；这里仅选择每件事使用哪个模型。
调用示例：<ModelSettings :draft="draft" />
-->
<script setup>
import { computed } from 'vue'
import Select from '../../ui/Select.vue'
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
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
    <SettingsList title="默认模型">
      <SettingsRow title="默认模型" description="新对话开始时使用这个模型；已有对话可在输入框旁单独切换">
        <Select class="model-settings__select" label="默认模型" :model-value="modelValue('chat')" :items="[{ value: '', label: '使用首个可用模型' }, ...modelOptions]" @update:model-value="chooseModel('chat', $event)" />
      </SettingsRow>
    </SettingsList>

    <SettingsList title="哪件事用哪个模型">
      <SettingsRow v-for="item in tasks" :key="item.task" :title="item.label" :description="item.hint">
        <Select class="model-settings__select" :label="item.label" :model-value="modelValue(item.task)" :items="modelChoices" @update:model-value="chooseModel(item.task, $event)" />
      </SettingsRow>
    </SettingsList>

    <p v-if="!modelOptions.length" class="model-settings__empty">还没有可用模型。先在「模型供应商」里添加一个供应商和模型。</p>
  </section>
</template>>

<style scoped lang="scss" src="../../styles/components/providers/ModelSettings.scss"></style>
