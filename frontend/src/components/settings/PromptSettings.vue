<!-- 提示词设置：展示全局提示词和字符数，并发出文本变化。 -->
<script setup>
import { t } from '../../i18n.js'                                      // 提供提示词配置文案
import TextAreaField from '../fields/TextAreaField.vue'               // 使用 M3E 自适应长文本字段
defineProps({ value: { type: String, default: '' } })
defineEmits(['update'])                                                // 将提示词变化交回 Command
</script>

<template>
  <section class="simple-settings prompt-settings">
    <header class="simple-settings__heading"><div><h3>{{ t('globalPrompt') }}</h3><p>{{ t('promptDescription') }}</p></div></header>
    <TextAreaField :model-value="value" :min-rows="10" :max-rows="20" :label="t('globalPrompt')" @update:model-value="$emit('update', $event)" />
    <small>{{ t('characterCount', { count: value.length }) }}</small>
  </section>
</template>
