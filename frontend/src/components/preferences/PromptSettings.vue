<!--
系统提示词设置：编辑隔离草稿里的助手身份、回复偏好和工作规则。
标题和说明在左，长文本编辑区在右；移动端自动上下排列。
调用示例：<PromptSettings :draft="draft" />；保存由 SettingsView 统一触发。
-->
<script setup>
import Field from '../../ui/Field.vue'
import SettingsList from '../../ui/SettingsList.vue'
import SettingsRow from '../../ui/SettingsRow.vue'

const props = defineProps({ draft: { type: Object, required: true } })
</script>

<template>
  <section class="prompts-settings">
    <SettingsList title="助手行为">
      <SettingsRow title="系统提示词" description="设置助手的身份、回复偏好和工作规则。留空表示不使用系统提示词" wide>
        <div class="prompts-control">
          <Field
            :model-value="draft.prompt"
            multiline
            :rows="10"
            label="系统提示词"
            placeholder="留空表示不使用系统提示词；清空后不会被自动恢复。"
            @update:model-value="props.draft.prompt = $event"
          />
          <span class="prompts-count">{{ draft.prompt.length }} 字符</span>
        </div>
      </SettingsRow>
    </SettingsList>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/preferences/PromptSettings.scss"></style>
