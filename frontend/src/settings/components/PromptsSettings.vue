<!--
系统提示词设置：编辑助手的身份、回复偏好和工作规则，内容通过 update:prompt 交给上层写回草稿。
长文本使用 Field 的 multiline 模式，label 仍指向真正的 textarea，字符计数保持原样。
调用示例：<PromptsSettings v-model:prompt="draft.prompt" />
-->
<script setup>
import { Field } from '../../ui/index.js'

defineProps({ prompt: { type: String, default: '' } })
defineEmits(['update:prompt'])
</script>

<template>
  <section class="prompts-settings">
    <div class="prompts-card">
      <p class="prompts-lead">设置助手的身份、回复偏好和工作规则。</p>
      <Field
        :model-value="prompt"
        multiline
        :rows="12"
        label="系统提示词"
        placeholder="留空表示不使用系统提示词；清空后不会被自动恢复。"
        @update:model-value="$emit('update:prompt', $event)"
      />
      <span class="prompts-count">{{ prompt.length }} 字符</span>
    </div>
    <p class="prompts-hint">默认提示词只在第一次使用时填入。你可以随意修改或完全清空；清空后不会自动恢复。项目规则仍按「读取项目规则」开关单独追加。</p>
  </section>
</template>

<style scoped lang="scss">
.prompts-settings { display: flex; flex-direction: column; gap: 16px; color: var(--la-secondary); font-size: 14px; }
.prompts-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  border-radius: 20px;
  background: var(--la-layer-01);
}
.prompts-lead { margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
.prompts-count { align-self: flex-end; color: var(--la-muted); font-size: 13px; line-height: 18px; }
.prompts-hint { margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
@media (max-width: 767px) {
  .prompts-card { padding: 20px; }
}
</style>
