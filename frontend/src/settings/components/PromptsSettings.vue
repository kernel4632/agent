<!--
系统提示词设置：编辑助手的身份、回复偏好和工作规则，内容通过 update:prompt 交给上层写回草稿。
长文本使用 Field 的 multiline 模式，id 和 label 仍指向真正的 textarea，字符计数保持原样。
调用示例：<PromptsSettings v-model:prompt="draft.prompt" />
-->
<script setup>
import Field from '../../ui/Field.vue'

defineProps({ prompt: String })
defineEmits(['update:prompt'])
</script>

<template>
  <section class="prompts-settings">
    <label for="system-prompt">设置助手的身份、回复偏好和工作规则。</label>
    <Field id="system-prompt" :model-value="prompt" multiline label="系统提示词" placeholder="留空表示不使用系统提示词；清空后不会被自动恢复。" @update:model-value="$emit('update:prompt', $event)" />
    <span>{{ prompt.length }} 字符</span>
    <p class="prompts-settings__hint">默认提示词只在第一次使用时填入。你可以随意修改或完全清空；清空后不会自动恢复。项目规则仍按“读取项目规则”开关单独追加。</p>
  </section>
</template>

<style scoped lang="scss">
.prompts-settings {
  display: grid; gap: 8px; color: var(--la-muted); font-size: 13px;
  :deep(.ui-field__input.ui-field__input--multiline) { min-height: 320px; height: auto; padding: 12px; resize: vertical; border-radius: 8px; background: var(--la-layer-01); box-shadow: inset 0 0 0 .5px var(--la-line); line-height: 20px; }
  span { text-align: right; color: var(--la-muted); font-size: 12px; }
  &__hint { margin: 0; color: var(--la-muted); font-size: 12px; line-height: 1.7; }
}
</style>
