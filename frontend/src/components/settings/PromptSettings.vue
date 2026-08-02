<!--
系统提示词定义：展示全局提示词编辑器并反馈文本变化。
设置指令接收变化后更新草稿，离开设置页时统一保存。
调用示例：<PromptSettings :value="prompt" @update="Settings.updatePrompt" />
-->
<script setup>
import { t } from '../../i18n.js'                                      // 提供提示词配置文案
import TextAreaField from '../shared/TextAreaField.vue'               // 使用 M3E 自适应长文本字段
defineProps({ value: { type: String, default: '' } })
defineEmits(['update'])                                                // 将提示词变化交回 Command
</script>

<template>
  <section class="simple-settings prompt-settings">
    <header class="simple-settings__heading"><h3>{{ t('globalPrompt') }}</h3></header>
    <TextAreaField :model-value="value" :min-rows="10" :max-rows="20" :label="t('globalPrompt')" @update:model-value="$emit('update', $event)" />
  </section>
</template>
