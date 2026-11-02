<!--
设置页外壳：全屏占用 App 主区，只负责“设置首页 / 一级页面 / 二级页面”的切换、草稿保存和关闭。
首页按本文件设置表的 group 显示圆角卡片；点一行进入一级页面，实体页面再点一行进入二级编辑页。
字段接线和保存逻辑都不在这里：保存统一调用 Settings.save()，关闭仍由 Navigation.closeSettings() 自动保存。
调用示例：<SettingsView />；打开首页用 Navigation.openSettings()，直接进详情用 Navigation.openSettings('providers')。
-->
<script setup>
import { Navigation } from '../commands/navigation.js'
import { Settings } from '../commands/settings.js'
import { store } from '../store.js'

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../ui/Icon.vue'
import Button from '../ui/Button.vue'
// 面板顺序和视觉组件属于本页面；功能保存仍调用 commands/settings。
import AppearanceSettings from '../components/preferences/AppearanceSettings.vue'
import ContextSettings from '../components/preferences/ContextSettings.vue'
import ModelSettings from '../components/providers/ModelSettings.vue'
import ProviderList from '../components/providers/ProviderList.vue'
import PromptSettings from '../components/preferences/PromptSettings.vue'
import ToolsSettings from '../components/capabilities/ToolsSettings.vue'
import MCPList from '../components/capabilities/MCPList.vue'

const settingsPages = [
  { id: 'appearance', label: '通用', description: '主题、强调色和界面偏好', icon: 'settings', group: '通用设置', tone: 'primary', component: AppearanceSettings },
  { id: 'providers', label: '模型供应商', description: '连接模型服务并管理可用模型', icon: 'globe', group: '模型与服务', tone: 'primary', component: ProviderList, nested: true },
  { id: 'model', label: '模型', description: '默认模型和任务分工', icon: 'spark', group: '模型与服务', tone: 'primary', component: ModelSettings },
  { id: 'context', label: '上下文', description: '自动压缩阈值和历史整理', icon: 'stats', group: '模型与服务', tone: 'tertiary', component: ContextSettings },
  { id: 'prompts', label: '系统提示词', description: '设置全局助手行为和回复风格', icon: 'document', group: '模型与服务', tone: 'tertiary', component: PromptSettings },
  { id: 'tools', label: '工具管理', description: '查看工具权限并调整批准方式', icon: 'code', group: '模型与服务', tone: 'primary', component: ToolsSettings, nested: true },
  { id: 'mcp', label: 'MCP 服务', description: '连接外部工具和数据服务', icon: 'link', group: '模型与服务', tone: 'tertiary', component: MCPList, nested: true },
  { id: 'data', label: '数据管理', description: '导出、备份和清理本地数据', icon: 'folder', group: '数据设置', tone: 'secondary', disabled: true },
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

// 当前页只存一份：Navigation.openSettings(section) 写 store，页面和标题都从它派生。
const selected = computed({
  get: () => store.ui.settingsSection || '',
  set: value => { store.ui.settingsSection = value },
})
const scroll = ref(null)

// 换设置页时从顶部开始：上一页滚到一半，新页面不能接着从中间显示。
function resetScroll() {
  if (scroll.value) scroll.value.scrollTop = 0
}
const selectedPage = computed(() => {
  const page = settingsPages.find(item => item.id === selected.value)
  return page?.component && !page.disabled ? page : null
})
const groups = computed(() => groupSettingsPages(settingsPages))
const draft = computed(() => store.settings.draft)
// 二级页面只多一层：供应商列表 → 某个供应商，MCP 列表 → 某个服务。
const detail = computed(() => store.ui.settingsDetail)
const title = computed(() => detail.value?.title || selectedPage.value?.label || '设置')

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
  if (!store.settings.draft) return
  window.clearTimeout(autoSaveTimer)
  autoSaveTimer = window.setTimeout(runAutoSave, 600)
}

async function runAutoSave() {
  autoSaveTimer = null
  await Settings.autoSave()
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
  <section class="settings-screen" aria-label="设置">
    <header class="settings-topbar">
      <div class="settings-topbar__inner">
        <div class="settings-topbar__actions">
          <Button icon label="返回" @click="goBack"><Icon name="arrow" :size="18" class="settings-back-icon" /></Button>
        </div>
        <div class="settings-topbar__heading">
          <h1 :title="title">{{ title }}</h1>
        </div>
      </div>
    </header>

    <div ref="scroll" class="settings-scroll">
      <Transition name="settings-view" mode="out-in" @before-enter="resetScroll">
        <!-- 详情页自己可能是多根组件（如模型供应商页），统一包一层单根容器，过渡才有落点。 -->
        <div v-if="selectedPage && draft" :key="`${selected}:${detail?.id || ''}`" class="settings-detail">
          <component
            :is="selectedPage.component"
            :draft="draft"
            :detail="selectedPage.nested ? detail : undefined"
            @open-detail="Navigation.openDetail"
            @close-detail="Navigation.closeDetail"
            @update-detail-title="Navigation.updateDetailTitle"
          />
        </div>

        <div v-else key="home" class="settings-home">
          <section v-for="group in groups" :key="group.label" class="settings-group">
            <h2 class="settings-group__label">{{ group.label }}</h2>
            <div class="settings-card">
              <Button
                v-for="page in group.items"
                :key="page.id"
                variant="plain"
                class="settings-row"
                :disabled="page.disabled"
                :title="page.disabled ? '暂不支持此管理功能' : undefined"
                @click="openPage(page)"
              >
                <span class="settings-row__icon" :class="`settings-row__icon--${page.tone || 'secondary'}`" aria-hidden="true">
                  <Icon :name="page.icon" :size="20" />
                </span>
                <span class="settings-row__text">
                  <span class="settings-row__title">{{ page.label }}</span>
                  <span class="settings-row__description">{{ page.description }}</span>
                </span>
                <span v-if="page.disabled" class="settings-row__badge">待支持</span>
                <Icon name="arrow" :size="16" class="settings-row__arrow" aria-hidden="true" />
              </Button>
            </div>
          </section>
        </div>
      </Transition>
    </div>

  </section>
</template>

<style scoped lang="scss" src="../styles/views/SettingsView.scss"></style>
