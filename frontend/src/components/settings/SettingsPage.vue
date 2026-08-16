<!--
设置页壳：维护整页草稿、分类切换与离开页面自动保存。
设计思想：具体分类组件只修改草稿，保存时机由本页统一管理。
核心数据：settingsDraft（隔离草稿）、selectedSectionID（当前分类）。
调用示例：<SettingsPage @save="Settings.replaceDraftAndSave" />。
-->
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'          // 引入响应式计算、卸载钩子和本地状态
import ProviderSettings from './ProviderSettings.vue'         // 引入供应商配置分类
import ToolsSettings from './ToolsSettings.vue'               // 引入工具权限管理分类
import MCPSettings from './MCPSettings.vue'                   // 引入 MCP 服务管理分类
import PromptsSettings from './PromptsSettings.vue'           // 引入系统提示词编辑分类
import AppearanceSettings from './AppearanceSettings.vue'     // 引入外观分类
import SettingsNavigation from './SettingsNavigation.vue'     // 引入设置分类总览
import SettingsPlaceholder from './SettingsPlaceholder.vue'   // 引入尚未实现分类的占位组件（数据管理）
import { Settings } from '../../commands/settings.js'         // 引入设置草稿创建指令
import { store } from '../../store.js'                        // 引入全局设置草稿状态
import { ArrowLeft01Icon, Share01Icon, Wrench01Icon, GridViewIcon, FileEditIcon, ColorsIcon, Database01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/vue'
import { ICON_STROKE_WIDTH } from '../../theme.js'

const emit = defineEmits(['save'])                            // 离开设置页时向业务层提交完整设置快照

const sections = [                                            // 设置分类定义，供导航和正文共同使用
  { id: 'providers', label: '供应商配置', navLabel: '模型供应商', icon: Share01Icon, description: '配置模型供应商、凭据与模型能力。' },
  { id: 'tools', label: '工具管理', icon: Wrench01Icon, description: '管理 Agent 可调用的本地与内置工具。' },
  { id: 'mcp', label: 'MCP 管理', navLabel: 'MCP 服务', icon: GridViewIcon, description: '连接、启用并诊断 MCP 服务。' },
  { id: 'prompts', label: '系统提示词定义', navLabel: '系统提示词', icon: FileEditIcon, description: '维护系统提示词和可复用规则片段。' },
  { id: 'appearance', label: '外观', icon: ColorsIcon, description: '调整动态颜色、对比度、密度与界面动效。' },
  { id: 'data', label: '数据管理', icon: Database01Icon, description: '导入、导出、清理或迁移本地数据。' },
]

const selectedSectionID = ref(null)                           // 首次进入设置时展示分类总览
const settingsTransitionName = ref('settings-forward')        // 根据进入或返回方向选择对应页面动效
const selectedSection = computed(() => sections.find(section => section.id === selectedSectionID.value)) // 当前分类对象供正文标题和占位复用

// 组件初始化时确保隔离草稿存在，避免从主页直接跳转到设置时草稿为空
if (!store.settings.draft) Settings.open()

const settingsDraft = computed(() => store.settings.draft)    // 所有分类子组件共享的正式隔离草稿

function updateAppearance({ field, value }) {
  store.settings.draft.appearance[field] = value
}

function openSection(sectionID) {
  settingsTransitionName.value = 'settings-forward'
  selectedSectionID.value = sectionID
}

function closeSection() {
  settingsTransitionName.value = 'settings-back'
  selectedSectionID.value = null
}


// --- 离开设置页时保存当前草稿快照 ---
function saveSettings() {
  if (settingsDraft.value) emit('save', structuredClone(settingsDraft.value)) // 克隆后提交，避免外部继续引用内部响应式数据
}


onBeforeUnmount(saveSettings)                                 // 路由卸载或预览切换都视为离开设置页
</script>

<template>
  <main class="settings-page">
    <Transition :name="settingsTransitionName" mode="out-in">
      <SettingsNavigation v-if="!selectedSectionID" key="overview" :items="sections" selected-id="" @select="openSection" />
      <section v-else-if="settingsDraft" :key="selectedSectionID" class="settings-page__detail">
        <header class="settings-page__detail-header">
          <m3e-icon-button type="button" shape="rounded" aria-label="返回设置" title="返回设置" @click="closeSection">
            <HugeiconsIcon :icon="ArrowLeft01Icon" :stroke-width="ICON_STROKE_WIDTH" />
          </m3e-icon-button>
          <div>
            <m3e-heading variant="headline" size="small" level="1">{{ selectedSection.label }}</m3e-heading>
            <span>{{ selectedSection.description }}</span>
          </div>
        </header>
        <ProviderSettings v-if="selectedSectionID === 'providers'" class="settings-page__body" v-model:providers="settingsDraft.providers" />
        <ToolsSettings v-else-if="selectedSectionID === 'tools'" class="settings-page__body settings-page__body--padded" v-model:tools="settingsDraft.tools" />
        <MCPSettings v-else-if="selectedSectionID === 'mcp'" class="settings-page__body" v-model:mcp="settingsDraft.mcp" />
        <PromptsSettings v-else-if="selectedSectionID === 'prompts'" class="settings-page__body" v-model:prompt="settingsDraft.prompt" />
        <AppearanceSettings v-else-if="selectedSectionID === 'appearance'" class="settings-page__body settings-page__body--padded" :appearance="settingsDraft.appearance" @change="updateAppearance" />
        <SettingsPlaceholder
          v-else
          class="settings-page__body"
          :title="selectedSection.label"
          :description="selectedSection.description"
          :icon="selectedSection.icon"
        />
      </section>
    </Transition>
  </main>
</template>

<style scoped lang="scss">
/* --- 设置页主容器 --- */
.settings-page {
  display: flex;
  width: 100%;
  min-height: 100%;
  flex-direction: column;
  background: var(--md-sys-color-background);
}

.settings-page__detail {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.settings-page__detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 32px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.settings-page__detail-header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.settings-page__detail-header span {
  color: var(--md-sys-color-outline);
  font-size: 13px;
}


.settings-page__body {
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  flex: 1 1 auto;
}

.settings-page__body--padded {
  padding: 24px 40px 48px;
}

.settings-forward-enter-active,
.settings-back-enter-active {
  transition: opacity 220ms ease, transform 300ms var(--motion-spring-bouncy);
}

.settings-forward-leave-active,
.settings-back-leave-active {
  transition: opacity 120ms ease, transform 140ms ease;
}

.settings-forward-enter-from,
.settings-back-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

.settings-forward-leave-to,
.settings-back-enter-from {
  opacity: 0;
  transform: translateX(-16px);
}

@media (prefers-reduced-motion: reduce) {
  .settings-forward-enter-active,
  .settings-forward-leave-active,
  .settings-back-enter-active,
  .settings-back-leave-active {
    transition: none;
  }
}

/* --- 窄屏适配：纵向堆叠导航和内容 --- */
@media (max-width: 760px) {
  .settings-page__detail-header { padding: 14px 16px; }
  .settings-page__body--padded { padding: 20px 20px 40px; }
}
</style>
