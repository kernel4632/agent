<!--
设置页面栈：首页、一级页面、二级编辑页各有自己的页头与滚动区域。
进入新页只在上面加一层，返回时只滑出最上层；下面页面的内容、搜索和滚动位置保留。
字段保存调用 Settings，路径操作调用 Navigation；本文件只装配页面与管理动画焦点。
调用示例：<SettingsView />；打开首页用 Navigation.openSettings()，直接进详情用 Navigation.openSettings('providers')。
-->
<script setup>
import { Navigation } from '../commands/navigation.js'
import { Settings, PROVIDER_TYPES } from "../features/settings.js"
import { store } from '../store.js'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '../ui/Icon.vue'
import Button from '../ui/Button.vue'
// 面板顺序和视觉组件属于本页面；功能保存仍调用 features/settings。
import AppearanceSettings from '../components/preferences/AppearanceSettings.vue'
import ContextSettings from '../components/preferences/ContextSettings.vue'
import ModelSettings from '../components/providers/ModelSettings.vue'
import ProviderList from '../components/providers/ProviderList.vue'
import PromptSettings from '../components/preferences/PromptSettings.vue'
import DataSettings from '../components/preferences/DataSettings.vue'
import MCPList from '../components/capabilities/MCPList.vue'
import SkillList from '../components/capabilities/SkillList.vue'

const settingsPages = [
  { id: 'appearance', label: '通用', description: '主题、强调色和界面偏好', icon: 'settings', group: '通用设置', tone: 'primary', component: AppearanceSettings },
  { id: 'providers', label: '模型供应商', description: '连接模型服务并管理可用模型', icon: 'globe', group: '模型与服务', tone: 'primary', component: ProviderList, nested: true },
  { id: 'model', label: '模型', description: '默认模型和任务分工', icon: 'spark', group: '模型与服务', tone: 'primary', component: ModelSettings },
  { id: 'context', label: '上下文', description: '自动压缩阈值和压缩后保留的原文', icon: 'stats', group: '模型与服务', tone: 'tertiary', component: ContextSettings },
  { id: 'prompts', label: '系统提示词', description: '设置全局助手行为和回复风格', icon: 'document', group: '模型与服务', tone: 'tertiary', component: PromptSettings },
  // 工具自动批准不在这里：它是「发这条消息时要不要拦」的临时判断，
  // 放在对话框输入区（ComposerTools），干活时不用离开当前上下文去翻设置。
  { id: 'skills', label: '技能', description: '识别并管理本机的操作说明', icon: 'idea', group: '模型与服务', tone: 'tertiary', component: SkillList },
  { id: 'mcp', label: 'MCP 服务', description: '连接外部工具和数据服务', icon: 'link', group: '模型与服务', tone: 'tertiary', component: MCPList, nested: true },
  { id: 'data', label: '数据管理', description: '配置备份、恢复与导入导出', icon: 'folder', group: '数据设置', tone: 'secondary', component: DataSettings },
]

// 按登记顺序分组；新增页面落在哪个 group，设置首页就自动出现对应卡片。
function groupSettingsPages(pages = settingsPages) {
  const groups = []
  for (const page of pages) {
    let group = groups.find(item => item.label === page.group)
    if (!group) {
      group = { label: page.group, items: [] }
      groups.push(group)
    }
    group.items.push(page)
  }
  return groups
}

// 路径只存一份；从路径派生整条页面栈，父页面始终使用自己的标题、布局和 detail。
const selected = computed({
  get: () => store.ui.settingsSection || '',
  set: value => { store.ui.settingsSection = value },
})
const stack = ref(null)
const selectedPage = computed(() => {
  const page = settingsPages.find(item => item.id === selected.value)
  return page?.component && !page.disabled ? page : null
})
const groups = groupSettingsPages(settingsPages)
const draft = computed(() => store.settings.draft)
const detail = computed(() => store.ui.settingsDetail)
const detailBadge = layer => {
  if (layer.page?.id !== 'providers' || !layer.detail || !draft.value) return ''
  const provider = draft.value.providers.find(item => item.id === layer.detail.id)
  const label = PROVIDER_TYPES.find(item => item.value === provider?.apiType)?.label || ''
  return label && label !== String(layer.title || '').trim() ? label : ''
}
const layers = computed(() => {
  const pages = [{ key: 'home', title: '设置', page: null, detail: null }]
  const page = selectedPage.value
  if (!page) return pages
  pages.push({ key: `section:${page.id}`, title: page.label, page, detail: null })
  if (page.nested && detail.value) pages.push({ key: `detail:${page.id}:${detail.value.id}`, title: detail.value.title || page.label, page, detail: detail.value })
  return pages
})
const activeKey = computed(() => layers.value.at(-1).key)
watch(activeKey, () => {
  if (store.ui.settingsOpen) Navigation.saveSettingsPath()
}, { flush: 'post' })

// 被覆盖的页面仍在 DOM 中，但不能接收键盘或鼠标；返回时恢复原来的触发器焦点。
const openers = new Map()
watch(activeKey, (key, previous) => {
  if (layers.value.some(layer => layer.key === previous)) openers.set(key, document.activeElement)
}, { flush: 'sync' })

function focusPage() {
  // 动画期间用户已经开始操作新页或弹层时，结束动画不能再把焦点抢回标题。
  const focused = document.activeElement
  if (focused !== document.body && !focused.closest('[inert]')) return
  stack.value?.querySelector('.settings-screen:not([inert]) h1')?.focus({ preventScroll: true })
}

function beforeLeave(element) {
  element.inert = true
  element.setAttribute('aria-hidden', 'true')
}

function afterLeave(element) {
  const opener = openers.get(element.dataset.pageKey)
  openers.delete(element.dataset.pageKey)
  if (!store.ui.settingsOpen) return
  if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true })
  else focusPage()
}

onMounted(() => nextTick(focusPage))

// 首页分组来自登记表；新增页面只要写对 group，就会自动出现在对应卡片里。
function openPage(page) {
  if (page.disabled || !page.component) return
  Navigation.closeDetail()
  selected.value = page.id
}

// 返回设置首页时先落盘当前页面的修改，避免切换页面时丢掉刚输入的内容。
function goHome() {
  window.clearTimeout(autoSaveTimer)
  void Settings.autoSave()
  Navigation.closeDetail()
  selected.value = ''
}

// RikkaHub 的设置是边改边存：停止输入约 600ms 后自动提交，不再需要保存按钮。
let autoSaveTimer = null

function scheduleAutoSave() {
  if (!store.ui.settingsOpen || !store.settings.draft) return
  window.clearTimeout(autoSaveTimer)
  autoSaveTimer = window.setTimeout(runAutoSave, 600)
}

async function runAutoSave() {
  autoSaveTimer = null
  if (store.ui.settingsOpen) await Settings.autoSave()
}

watch(() => store.settings.draft, scheduleAutoSave, { deep: true })

onBeforeUnmount(() => window.clearTimeout(autoSaveTimer))

// 只有返回动作：详情页回到列表，列表回到设置首页，首页返回聊天页。关闭时仍会补一次保存。
function goBack() {
  if (detail.value) return Navigation.closeDetail()
  if (selectedPage.value) return goHome()
  void Navigation.closeSettings()
}
</script>

<template>
  <section ref="stack" class="settings-stack" aria-label="设置">
    <TransitionGroup name="settings-page" @before-leave="beforeLeave" @after-enter="focusPage" @after-leave="afterLeave">
      <section
        v-for="(layer, index) in layers" :key="layer.key" :data-page-key="layer.key"
        class="settings-screen" :class="{ 'settings-screen--provider': layer.page?.id === 'providers' && layer.detail }"
        :style="{ zIndex: index }" :inert="layer.key !== activeKey" :aria-hidden="layer.key !== activeKey || undefined"
      >
        <header class="settings-topbar">
          <div class="settings-topbar__inner">
            <div class="settings-topbar__actions">
              <Button icon class="settings-back" label="返回" title="返回" @click="goBack"><Icon name="arrow" :size="18" class="settings-back-icon" /></Button>
            </div>
            <div class="settings-topbar__heading"><h1 :title="layer.title" tabindex="-1">{{ layer.title }}</h1><span v-if="detailBadge(layer)" class="settings-topbar__badge">{{ detailBadge(layer) }}</span></div>
            <p v-if="!layer.page" class="settings-topbar__hint">所有修改会实时保存并生效</p>
          </div>
        </header>

        <div class="settings-scroll">
          <div v-if="layer.page && draft" class="settings-detail">
            <component
              :is="layer.page.component" :draft="draft" :detail="layer.page.nested ? layer.detail : undefined"
              @open-detail="Navigation.openDetail" @close-detail="Navigation.closeDetail" @update-detail-title="Navigation.updateDetailTitle"
            />
          </div>

          <div v-else class="settings-home">
            <section v-for="group in groups" :key="group.label" class="settings-group">
              <h2 class="settings-group__label">{{ group.label }}</h2>
              <div class="settings-card">
                <Button
                  v-for="page in group.items" :key="page.id" variant="plain" class="settings-row"
                  :disabled="page.disabled" :title="page.disabled ? '暂不支持此管理功能' : undefined" @click="openPage(page)"
                >
                  <span class="settings-row__icon" :class="`settings-row__icon--${page.tone || 'secondary'}`" aria-hidden="true"><Icon :name="page.icon" :size="20" /></span>
                  <span class="settings-row__text"><span class="settings-row__title">{{ page.label }}</span><span class="settings-row__description">{{ page.description }}</span></span>
                  <span v-if="page.disabled" class="settings-row__badge">待支持</span>
                  <Icon name="arrow" :size="16" class="settings-row__arrow" aria-hidden="true" />
                </Button>
              </div>
            </section>
          </div>
        </div>
      </section>
    </TransitionGroup>
  </section>
</template>

<style scoped lang="scss" src="../styles/views/SettingsView.scss"></style>
