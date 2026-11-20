<!--
权限询问条：覆盖在对话上方，刷新后从快照 extras.permission 恢复还在等的请求。
-->
<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ app: { type: Object, required: true } })
const asks = ref([])

props.app.on('permission.ask', data => {
    asks.value = [...asks.value.filter(item => item.requestId !== data.requestId), data]
})
props.app.on('permission.answered', data => {
    asks.value = asks.value.filter(item => item.requestId !== data.requestId)
})

const pending = computed(() => {
    const from = props.app.shared.Agent?.state?.extras?.permission
    const seen = new Set(asks.value.map(item => item.requestId))
    const recovered = (from ?? []).filter(item => !seen.has(item.requestId))
    return [...asks.value, ...recovered]
})

async function answer(item, allow, always = false) {
    await props.app.api.op('permission.answer', { requestId: item.requestId, allow, always })
    asks.value = asks.value.filter(one => one.requestId !== item.requestId)
    const extras = props.app.shared.Agent?.state?.extras
    if (extras?.permission) extras.permission = extras.permission.filter(one => one.requestId !== item.requestId)
}

function label(item) {
    const call = item.call ?? {}
    return call.toolName || '工具'
}
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
.ask__card { pointer-events: auto; width: min(520px, calc(100% - 32px)); background: var(--pane); border: 1px solid var(--line); border-radius: 16px; padding: 16px 18px; box-shadow: 0 12px 40px rgba(0,0,0,.08); }
.ask__card h3 { margin: 0 0 8px; font-size: 15px; }
.ask__card pre { margin: 0 0 12px; max-height: 160px; overflow: auto; background: var(--soft); border-radius: 10px; padding: 10px; font-size: 12px; white-space: pre-wrap; }
.ask__actions { display: flex; gap: 8px; justify-content: flex-end; }
.ask__actions button { border: 0; border-radius: 999px; padding: 8px 14px; font: inherit; cursor: pointer; background: var(--soft-strong); color: var(--text); }
.ask__ok { background: var(--primary) !important; color: var(--on-primary) !important; }
.ask__always { background: var(--soft) !important; }
</style>
