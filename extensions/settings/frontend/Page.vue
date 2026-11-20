<!--
整页设置：同一顶栏之下，左侧分类、右侧内容，顶部有「返回应用」。
模型、权限和扩展开关由本页提供；MCP、技能等分类由对应扩展登记到 parent: 'settings'。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import Form from './Form.vue'

const props = defineProps({
    app: { type: Object, required: true },
    shell: { type: Object, required: true },
})

const items = ref([])
async function load() { items.value = await props.app.api.op('settings.extensions') }
async function toggle(name, enabled) {
    await props.app.api.op('settings.toggle', { name, enabled })
    await load()
}

const categories = computed(() => {
    const extra = (props.shell.state.pages ?? []).filter(item => item.parent === 'settings')
    return [
        { id: 'models', title: '模型', forms: ['providers', 'models'] },
        { id: 'permission', title: '权限', forms: ['permission'] },
        ...extra.map(item => ({ id: item.id, title: item.title, component: item.component })),
        { id: 'extensions', title: '扩展' },
    ]
})

const current = computed(() => {
    const id = props.shell.category || 'models'
    return categories.value.find(item => item.id === id) || categories.value[0]
})

function open(id) { props.shell.go(id === 'models' ? '#/settings' : `#/settings/${id}`) }
function back() { props.shell.go(props.shell.state.back || '#/') }

load()
watch(() => props.app.api, load)
</script>

<template>
  <div class="page">
    <div class="page__top">
      <button type="button" class="page__back hit" @click="back">返回应用</button>
    </div>
    <div class="page__body">
      <nav class="page__nav">
        <button
          v-for="item in categories"
          :key="item.id"
          type="button"
          class="page__cat hit"
          :class="{ 'is-on': current?.id === item.id }"
          @click="open(item.id)"
        >{{ item.title }}</button>
      </nav>
      <div class="page__content">
        <h1>{{ current?.title }}</h1>
        <Form v-if="current?.forms" :api="app.api" :ids="current.forms" />
        <component v-else-if="current?.component" :is="current.component" :app="app" :api="app.api" />
        <section v-else class="page__ext">
          <label v-for="item in items" :key="item.name" class="page__row">
            <span>{{ item.name }}{{ item.error ? `（${item.error}）` : '' }}</span>
            <input type="checkbox" :checked="item.error !== '已关闭'" @change="toggle(item.name, $event.target.checked)">
          </label>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.page__top { display: flex; align-items: center; min-height: 52px; padding: 0 16px; border-bottom: 1px solid var(--line-soft); }
.page__back { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 14px; min-height: 40px; padding: 0 12px; border-radius: 999px; cursor: pointer; }
.page__back:hover { background: var(--hover); color: var(--text); }
.page__body { display: flex; flex: 1; min-height: 0; }
.page__nav { flex: none; width: min(200px, 38vw); overflow: auto; padding: 12px 8px; border-right: 1px solid var(--line-soft); }
.page__cat { display: block; width: 100%; min-height: 44px; padding: 0 14px; border: 0; border-radius: 12px; background: transparent; color: var(--muted); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.page__cat:hover { background: var(--hover); color: var(--text); }
.page__cat.is-on { background: var(--soft-strong); color: var(--text); font-weight: 550; }
.page__content { flex: 1; overflow: auto; padding: 24px 28px 80px; }
.page__content h1 { margin: 0 0 20px; font-size: 24px; font-weight: 550; letter-spacing: -.02em; }
.page__ext, .page__row { display: grid; gap: 10px; }
.page__row { display: flex; align-items: center; justify-content: space-between; min-height: 44px; font-size: 14px; }
.page__row input { width: 20px; height: 20px; }
</style>
