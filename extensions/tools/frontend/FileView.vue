<script setup>
const props = defineProps({ step: { type: Object, required: true } })
/** @param {import('agent-extension').ToolStep} step */
function text(step) {
    if (step.log) return step.log
    const output = step.output?.value ?? step.output
    if (output == null) return typeof step.input === 'object' ? JSON.stringify(step.input, null, 2) : (step.raw || '')
    if (typeof output === 'string') return output
    if (output.content) return output.content
    if (Array.isArray(output.entries)) return output.entries.map(/** @param {{ type?: string, name?: string }} item */ item => `${item.type === 'dir' ? 'd' : 'f'} ${item.name}`).join('\n')
    return JSON.stringify(output, null, 2)
}
</script>

<template>
  <pre class="view">{{ text(step) }}</pre>
</template>

<style scoped>
.view { margin: 0; max-height: 280px; overflow: auto; padding: 10px 12px; border-radius: 12px; background: var(--soft); color: var(--text); font: 12.5px/1.65 var(--mono); white-space: pre-wrap; word-break: break-word; }
</style>
