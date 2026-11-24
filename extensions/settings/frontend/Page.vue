<!--
设置整页，布局照旧前端 SettingsView（RikkaHub）：设置首页是分组的行（图标、标题、一行说明、箭头），点一行进分类页，
分类页里还能再点进详情（某个供应商、某条 MCP 连接），每层顶上都有圆形返回钮和标题。
宽屏（容器 ≥ 880px）左边常驻设置首页、右边是分类或详情；手机上一层一层叠，返回就退一层。
地址：#/settings 首页，#/settings/<分类>，#/settings/<分类>/<详情>。分类来自 shell.pages（parent: 'settings'），
后端登记了表单却没有专门页面的，自动成为「扩展设置」组里的一页，用 Form 渲染。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { ArrowLeft01Icon, Settings02Icon, SlidersHorizontalIcon } from '@hugeicons/core-free-icons'
import { kit } from './ui.js'
import Form from './Form.vue'

const props = defineProps({ app: { type: Object, required: true }, shell: { type: Object, required: true } })
const ui = kit(props.app.shared.Components.Icon)
const Icon = ui.Icon
/** @type {import('vue').Ref<Array<import('agent-extension').SettingForm>>} */
const forms = ref([])

async function load() { forms.value = await props.app.api.op('settings.forms').catch(() => []) }
load()

/** @type {import('vue').ComputedRef<Array<Record<string, any>>>} */
const sections = computed(() => {
    const pages = props.shell.state.pages.filter(/** @param {import('agent-extension').ShellPage} item */ item => item.parent === 'settings')
    const claimed = new Set(pages.flatMap(/** @param {import('agent-extension').ShellPage} item */ item => [item.id, ...(item.ids ?? [])]))
    const extra = forms.value.filter(/** @param {import('agent-extension').SettingForm} form */ form => !claimed.has(form.id)).map((form, index) => ({
        id: form.id, title: form.title, description: form.description || '由扩展登记的设置项', icon: SlidersHorizontalIcon,
        group: '扩展设置', order: 100 + index, component: Form, ids: [form.id],
    }))
    return [...pages, ...extra].sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
})

const groups = computed(() => {
    const map = new Map()
    for (const item of sections.value) map.set(item.group || '其他', [...(map.get(item.group || '其他') ?? []), item])
    return [...map.entries()]
})

const route = computed(() => {
    const [id = '', ...rest] = (props.shell.category || '').split('/')
    return { id, detail: rest.length ? decodeURIComponent(rest.join('/')) : '' }
})
const current = computed(() => sections.value.find(/** @param {Record<string, any>} item */ item => item.id === route.value.id) ?? null)

const nav = computed(() => ({
    open: /** @param {string} detail */ detail => props.shell.go(`#/settings/${route.value.id}/${encodeURIComponent(detail)}`),
    back: () => up(),
}))

/** @param {Record<string, any>} item */
function open(item) { props.shell.go(`#/settings/${item.id}`) }
function up() { props.shell.go(route.value.detail ? `#/settings/${route.value.id}` : '#/settings') }
function leave() { props.shell.go(props.shell.state.back || '#/') }

// 换分类时把右侧滚回顶部，避免停在上一页的位置。
/** @type {import('vue').Ref<HTMLElement | null>} */
const scroller = ref(null)
watch(() => props.shell.category, () => scroller.value?.scrollTo?.(0, 0))
</script>

<template>
  <div class="set">
    <div class="set__grid" :class="{ 'has-pane': current, 'has-detail': route.detail }">
      <aside class="set__home">
        <header class="set__head">
          <button type="button" class="ui-round set__round hit" aria-label="返回应用" title="返回应用" @click="leave"><Icon :icon="ArrowLeft01Icon" :size="18" /></button>
          <h1>设置</h1>
        </header>
        <div class="set__scroll">
          <p class="ui-hint">修改会立即保存并生效。</p>
          <ui.List v-for="[group, list] in groups" :key="group" :title="group">
            <ui.Row
              v-for="item in list" :key="item.id" link :icon="item.icon" :tone="item.tone"
              :title="item.title" :description="item.description" :on="current?.id === item.id" @click="open(item)"
            />
          </ui.List>
        </div>
      </aside>

      <section v-if="current" class="set__pane">
        <header class="set__head">
          <button type="button" class="ui-round set__round set__up hit" aria-label="返回" title="返回" @click="up"><Icon :icon="ArrowLeft01Icon" :size="18" /></button>
          <h1 :title="route.detail || current.title">{{ route.detail || current.title }}</h1>
        </header>
        <div ref="scroller" class="set__scroll">
          <div class="set__inner">
            <component :is="current.component" :key="current.id" :app="app" :api="app.api" :ui="ui" :detail="route.detail" :nav="nav" :ids="current.ids" />
          </div>
        </div>
      </section>
      <div v-else class="set__blank"><ui.Empty :icon="Settings02Icon" title="选择一项设置" text="左边是全部分类" /></div>
    </div>
  </div>
</template>

<style scoped>
.set { height: 100%; container: set / inline-size; }
.set__grid { display: grid; grid-template-columns: minmax(0, 1fr); height: 100%; min-height: 0; }
.set__home, .set__pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.set__grid.has-pane .set__home, .set__blank { display: none; }
.set__pane { container: pane / inline-size; }
.set__head { display: flex; align-items: center; gap: 10px; flex: none; height: 60px; padding: 0 16px; }
.set__head h1 { flex: 1; min-width: 0; margin: 0; font-size: 20px; font-weight: 500; letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.set__round { width: 36px; height: 36px; background: var(--soft-strong); color: var(--text); }
.set__scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px 64px; overscroll-behavior: contain; }
.set__inner { width: 100%; max-width: 720px; margin: 0 auto; }
@container set (min-width: 880px) {
  .set__grid { grid-template-columns: 360px minmax(0, 1fr); }
  .set__grid.has-pane .set__home { display: flex; }
  .set__home { border-right: 1px solid var(--line-soft); }
  .set__blank { display: grid; place-items: center; }
  .set__grid:not(.has-detail) .set__up { display: none; }
  .set__pane .set__head { padding: 0 max(28px, calc((100% - 720px) / 2)); }
  .set__pane .set__scroll { padding: 4px 28px 64px; }
}
</style>
