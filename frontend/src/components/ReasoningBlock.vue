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
  <m3e-card v-if="text || streaming" class="reasoning" :class="{ 'reasoning--active': streaming }">
    <m3e-button class="reasoning__trigger" @click="isOpen = !isOpen">
      <m3e-circular-progress-indicator v-if="streaming" class="reasoning__progress"></m3e-circular-progress-indicator>
      <m3e-icon v-else class="reasoning__spark" name="award_star"></m3e-icon>
      <span>{{ title }}</span>
      <m3e-icon class="reasoning__chevron" name="keyboard_arrow_down" :class="{ 'reasoning__chevron--open': isOpen }"></m3e-icon>
    </m3e-button>
    <div v-if="isOpen" class="reasoning__content">{{ text || t('thinkingPlaceholder') }}</div>
  </m3e-card>
</template>

<style lang="scss" src="../styles/components/ReasoningBlock.scss"></style>
