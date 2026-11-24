<!--
权限询问条：浮在输入框上方的圆角卡片，三个 40px 高的胶囊按钮（拒绝 / 总是允许 / 允许）。
刷新后从快照 extras.permission 恢复还在等的请求。
-->
<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ app: { type: Object, required: true } })
/** @typedef {{ requestId: string, call?: { toolName?: string, input?: unknown } }} AskItem */
/** @type {import('vue').Ref<Array<AskItem>>} */
const asks = ref([])

props.app.on('permission.ask', /** @param {AskItem} data */ data => {
    asks.value = [...asks.value.filter(item => item.requestId !== data.requestId), data]
})
props.app.on('permission.answered', /** @param {{ requestId: string }} data */ data => {
    asks.value = asks.value.filter(item => item.requestId !== data.requestId)
})

const pending = computed(() => {
    const from = props.app.shared.Agent?.state?.extras?.permission
    const seen = new Set(asks.value.map(item => item.requestId))
    const recovered = (from ?? []).filter(/** @param {AskItem} item */ item => !seen.has(item.requestId))
    return [...asks.value, ...recovered]
})

/** @param {AskItem} item @param {boolean} allow @param {boolean} [always] */
async function answer(item, allow, always = false) {
    await props.app.api.op('permission.answer', { requestId: item.requestId, allow, always })
    asks.value = asks.value.filter(one => one.requestId !== item.requestId)
    const extras = props.app.shared.Agent?.state?.extras
    if (extras?.permission) extras.permission = extras.permission.filter(/** @param {AskItem} one */ one => one.requestId !== item.requestId)
}

/** @param {AskItem} item */
function label(item) {
    const call = item.call ?? {}
    return call.toolName || '工具'
}
/** @param {AskItem} item */
function detail(item) {
    const input = item.call?.input
    try { return JSON.stringify(input, null, 2) } catch { return String(input ?? '') }
}
</script>

<template>
  <div v-if="pending.length" class="ask">
    <article v-for="item in pending" :key="item.requestId" class="ask__card">
      <h3>允许调用 {{ label(item) }}？</h3>
      <pre>{{ detail(item) }}</pre>
      <div class="ask__actions">
        <button type="button" @click="answer(item, false)">拒绝</button>
        <button type="button" class="ask__always" @click="answer(item, true, true)">总是允许</button>
        <button type="button" class="ask__ok" @click="answer(item, true)">允许</button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.ask { position: absolute; left: 0; right: 0; bottom: 120px; z-index: 30; display: grid; justify-items: center; pointer-events: none; }
.ask__card { pointer-events: auto; width: min(560px, calc(100% - 24px)); background: var(--pane); border: 1px solid var(--line); border-radius: 24px; padding: 16px 16px 14px 20px; box-shadow: 0 12px 32px -12px rgba(30, 25, 15, .25); }
.ask__card h3 { margin: 0 0 8px; font-size: 15px; }
.ask__card pre { margin: 0 0 12px; max-height: 160px; overflow: auto; background: var(--soft); border-radius: 10px; padding: 10px; font-size: 12px; white-space: pre-wrap; }
.ask__actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.ask__actions button { height: 40px; padding: 0 18px; border: 0; border-radius: 999px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; background: var(--soft-strong); color: var(--text); }
.ask__ok { background: var(--primary) !important; color: var(--on-primary) !important; }
.ask__always { background: var(--soft) !important; }
</style>
