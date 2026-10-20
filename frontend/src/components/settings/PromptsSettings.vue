<script setup>
defineProps({ prompt: String })
defineEmits(['update:prompt'])
</script>

<template>
  <section class="prompts-settings">
    <label for="system-prompt">设置助手的身份、回复偏好和工作规则。</label>
    <textarea id="system-prompt" class="field" aria-label="系统提示词" :value="prompt" placeholder="例如：用中文回答，保持简洁准确。" @input="$emit('update:prompt', $event.target.value)"></textarea>
    <span>{{ prompt.length }} 字符</span>
  </section>
</template>

<style scoped lang="scss">
.prompts-settings {
  display: grid; gap: 8px; color: var(--la-muted); font-size: 13px;
  textarea { min-height: 320px; height: auto; padding: 12px; resize: vertical; border-radius: 8px; background: var(--la-layer-01); box-shadow: inset 0 0 0 .5px var(--la-line); line-height: 20px; }
  span { text-align: right; color: var(--la-muted); font-size: 12px; }
}
</style>
