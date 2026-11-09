<!--
自动审核设置：开关、审核模型、策略和超时。
审核范围不在这里重复配置，统一由输入区「工具权限」里的动作决定：
某个工具或默认动作选 AI 审核，调用前才会先问审核模型。
调用示例：<ReviewSettings :draft="draft" />。
-->
<script setup>
import { computed } from 'vue'
import Field from '../../ui/Field.vue'
import Select from '../../ui/Select.vue'
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import Switch from '../../ui/Switch.vue'

const props = defineProps({
  draft: { type: Object, required: true },
})

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
const modelValue = computed(() => {
  const target = props.draft.models.review
  return target?.provider && target?.model ? JSON.stringify(target) : ''
})

function chooseModel(value) {
  props.draft.models.review = value ? JSON.parse(value) : { provider: '', model: '' }
}

function setEnabled(enabled) {
  props.draft.review.enabled = enabled
}
</script>

<template>
  <section class="review-settings" aria-label="自动审核">
    <SettingsList title="自动审核">
      <SettingsRow title="启用 AI 审核" description="打开后，权限动作设为 AI 审核的工具调用会先问审核模型；审核器不确定时仍然问你">
        <Switch :model-value="draft.review.enabled === true" label="启用 AI 审核" hide-label @update:model-value="setEnabled" />
      </SettingsRow>
      <SettingsRow title="审核模型" description="审核请求会发到这个模型，工具参数和最后一条用户请求也会一起发过去；不选就和默认模型共用">
        <Select class="review-settings__select" label="审核模型" :model-value="modelValue" :items="modelChoices" @update:model-value="chooseModel" />
      </SettingsRow>
    </SettingsList>

    <SettingsList title="审核策略">
      <SettingsRow wide title="审核规则" description="留空使用内置策略。审核器只看到这次工具调用、当前目录和最后一条用户请求">
        <Field
          :model-value="draft.review.policy"
          multiline
          :rows="8"
          caption="审核策略"
          placeholder="留空使用内置策略：只读操作允许；删除、越界、访问凭据、外发数据等拒绝；不确定时 ask。"
          @update:model-value="draft.review.policy = $event"
        />
      </SettingsRow>
      <SettingsRow title="审核超时" description="单次审核的上限，超时后回到人工审批">
        <Field
          :model-value="draft.review.timeout"
          class="review-settings__timeout"
          type="number"
          caption="审核超时（毫秒）"
          hint="1000 到 120000"
          @update:model-value="draft.review.timeout = $event"
        />
      </SettingsRow>
    </SettingsList>

    <p class="review-settings__hint">
      审核范围在输入区的「工具权限」里设置：把默认动作或单个工具设为「AI 审核」。审核器返回拒绝时工具不会执行；返回不确定或请求失败时，会回到原来的审批弹窗。
    </p>
    <p v-if="!modelOptions.length" class="review-settings__empty">还没有可用模型。先在「模型供应商」里添加一个供应商和模型。</p>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/capabilities/ReviewSettings.scss"></style>
