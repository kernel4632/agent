<!--
系统提示词设置：编辑隔离草稿里的助手身份、回复偏好和工作规则。
长文本使用 Field 的 multiline 模式，label 仍指向真正的 textarea，字符计数保持原样。
调用示例：<PromptSettings :draft="draft" />；保存由 SettingsView 统一触发。
-->
<script setup>
import { Field } from '../ui/index.js'

const props = defineProps({ draft: { type: Object, required: true } })
</script>

<template>
  <section class="prompts-settings">
    <div class="prompts-card">
      <p class="prompts-lead">设置助手的身份、回复偏好和工作规则。</p>
      <Field
        :model-value="draft.prompt"
        multiline
        :rows="12"
        label="系统提示词"
        placeholder="留空表示不使用系统提示词；清空后不会被自动恢复。"
        @update:model-value="props.draft.prompt = $event"
      />
      <span class="prompts-count">{{ draft.prompt.length }} 字符</span>
    </div>
    <p class="prompts-hint">默认提示词只在第一次使用时填入。你可以随意修改或完全清空；清空后不会自动恢复。项目规则仍按「读取项目规则」开关单独追加。</p>
  </section>
</template>

<style scoped lang="scss" src="../styles/components/PromptSettings.scss"></style>
