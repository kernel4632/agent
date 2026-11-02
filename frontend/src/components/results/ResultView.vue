<!--
结束/追问结果：显示 attempt_completion 或 ask_followup_question 的文本。
调用示例：<ResultView :tool="tool" />
-->
<script>
// 服务端声明的输出类型；注册归本视图所有。
export const kinds = ["completion","question"]
</script>
<script setup>
import { computed } from 'vue'
import { uiFor } from '../../commands/tool.js'
import { useToolContent } from './content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, text } = useToolContent(props)
const question = computed(() => uiFor(props.tool.name).view === 'question')
const content = computed(() => text.value || input.value.question || input.value.result || '')
</script>

<template>
  <div class="tool-result" :class="{ 'is-question': question }">{{ content }}</div>
</template>

<style scoped lang="scss" src="../../styles/components/results/ResultView.scss"></style>
