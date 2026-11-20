<!--
命令工具的内容区：运行中展示实时日志，结束后展示退出码和输出。
-->
<script setup>
const props = defineProps({ step: { type: Object, required: true } })
function text(step) {
    if (step.log) return step.log
    const output = step.output?.value ?? step.output
    if (output == null) return step.raw || ''
    if (typeof output === 'string') return output
    const body = [output.stdout, output.stderr].filter(Boolean).join('\n')
    const head = output.code == null ? '' : `退出码 ${output.code}\n`
    return head + (body || JSON.stringify(output, null, 2))
}
</script>

<template>
  <pre class="view">{{ text(step) }}</pre>
</template>

<style scoped>
.view { margin: 0; max-height: 280px; overflow: auto; padding: 10px 12px; border-radius: 12px; background: var(--soft); color: var(--text); font: 12.5px/1.65 var(--mono); white-space: pre-wrap; word-break: break-word; }
</style>
