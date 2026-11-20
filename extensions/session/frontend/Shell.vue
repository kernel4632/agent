<!--
会话壳：左侧边栏 + 原来的对话页。切换会话就是换 id 再连一次推送通道。
地址用 #/s/<id>，刷新后还停在同一个会话。
-->
<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import Sidebar from './Sidebar.vue'

const props = defineProps({
    app: { type: Object, required: true },
    original: { type: Object, required: true },
})

const current = ref(read())
const sidebar = ref()

function read() {
    const hit = location.hash.match(/^#\/s\/([^/]+)/)
    return hit?.[1] || props.app.api.id?.() || 'main'
}

function open(id) {
    if (!id) return
    current.value = id
    if (location.hash !== `#/s/${id}`) history.replaceState(null, '', `#/s/${id}`)
    props.app.shared.Agent.connect(id)
    sidebar.value?.load()
}

function onHash() { open(read()) }

onMounted(async () => {
    window.addEventListener('hashchange', onHash)
    const list = await props.app.api.op('session.list')
    if (!list.some(item => item.id === current.value)) {
        if (list[0]) open(list[0].id)
        else {
            const created = await props.app.api.op('session.create', { title: '新会话' })
            open(created.id)
        }
        return
    }
    open(current.value)
})
onUnmounted(() => window.removeEventListener('hashchange', onHash))

watch(() => current.value, () => sidebar.value?.load())
const original = computed(() => props.original)
</script>

<template>
  <div class="shell">
    <Sidebar ref="sidebar" :api="app.api" :current="current" @open="open" @create="item => open(item.id)" />
    <div class="shell__main">
      <component :is="original" />
    </div>
  </div>
</template>

<style scoped>
.shell { display: flex; height: 100dvh; background: var(--bg); }
.shell__main { flex: 1; min-width: 0; position: relative; }
</style>
