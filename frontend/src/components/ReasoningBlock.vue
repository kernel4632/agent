<!--
思考内容组件：折叠展示模型 reasoning，并在流式生成时显示柔和脉冲反馈。
组件只接收 text 和 streaming，不修改对话数据。
调用示例：<ReasoningBlock :text="message.reasoning" :streaming="message.isStreaming" />。
-->
<script setup>
import { computed, ref } from 'vue'                 // 引入折叠状态和标题派生能力
import { t } from '../i18n.js'                      // 引入响应式界面翻译

const props = defineProps({                         // 声明父组件传入的思考数据
  text: { type: String, default: '' },              // 完整或流式 reasoning 文本
  streaming: { type: Boolean, default: false },     // 当前是否仍在生成
})

const isOpen = ref(false)                           // 思考内容默认折叠，减少对正文干扰
const title = computed(() => t(props.streaming ? 'thinking' : 'reasoning')) // 根据流状态提供明确反馈


</script>

<template>
  <mdui-card v-if="text || streaming" variant="filled" class="reasoning" :class="{ 'reasoning--active': streaming }">
    <mdui-button class="reasoning__trigger" variant="text" full-width @click="isOpen = !isOpen">
      <span class="reasoning__spark"></span>
      <span>{{ title }}</span>
      <span class="reasoning__chevron" :class="{ 'reasoning__chevron--open': isOpen }">⌄</span>
    </mdui-button>
    <div v-if="isOpen" class="reasoning__content">{{ text || t('thinkingPlaceholder') }}</div>
  </mdui-card>
</template>

<style lang="scss" src="../styles/components/ReasoningBlock.scss"></style>
