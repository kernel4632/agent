<!--
设置页壳：维护整页草稿、分类切换与离开页面自动保存。
设计思想：具体分类组件只修改草稿，保存时机由本页统一管理。
核心数据：settingsDraft（隔离草稿）、selectedSectionID（当前分类）。
调用示例：<SettingsPage @save="Settings.replaceDraftAndSave" />。
-->
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'          // 引入响应式计算、卸载钩子和本地状态
import ProviderSettings from './ProviderSettings.vue'         // 引入供应商配置分类（当前唯一完整实现）
import SettingsNavigation from './SettingsNavigation.vue'     // 引入左侧分类导航
import SettingsPlaceholder from './SettingsPlaceholder.vue'   // 引入尚未实现分类的占位组件
import { Settings } from '../../commands/settings.js'         // 引入设置草稿创建指令
import { store } from '../../store.js'                        // 引入全局设置草稿状态

const emit = defineEmits(['save'])                            // 离开设置页时向业务层提交完整设置快照

const sections = [                                            // 设置分类定义，供导航和正文共同使用
  { id: 'providers', label: '供应商配置', icon: 'hub', description: '配置模型供应商、凭据与模型能力。' },
  { id: 'tools', label: '工具管理', icon: 'build', description: '管理 Agent 可调用的本地与内置工具。' },
  { id: 'mcp', label: 'MCP 管理', icon: 'dns', description: '连接、启用并诊断 MCP 服务。' },
  { id: 'prompts', label: '系统提示词定义', icon: 'text_snippet', description: '维护系统提示词和可复用规则片段。' },
  { id: 'appearance', label: '语言与外观', icon: 'palette', description: '调整语言、主题、字号与界面密度。' },
  { id: 'data', label: '数据管理', icon: 'database', description: '导入、导出、清理或迁移本地数据。' },
]

const selectedSectionID = ref('providers')                    // 首次进入设置时展示供应商配置
const selectedSection = computed(() => sections.find(section => section.id === selectedSectionID.value)) // 当前分类对象供正文标题和占位复用

// 组件初始化时确保隔离草稿存在，避免从主页直接跳转到设置时草稿为空
if (!store.settings.draft) Settings.open()

const settingsDraft = computed(() => store.settings.draft)    // 所有分类子组件共享的正式隔离草稿


// --- 离开设置页时保存当前草稿快照 ---
function saveSettings() {
  emit('save', structuredClone(settingsDraft.value))          // 克隆后提交，避免外部继续引用内部响应式数据
}


onBeforeUnmount(saveSettings)                                 // 路由卸载或预览切换都视为离开设置页
</script>

<template>
  <main class="settings-page">
    <SettingsNavigation :items="sections" :selected-id="selectedSectionID" @select="selectedSectionID = $event" />
    <section class="settings-page__content">
      <ProviderSettings v-if="selectedSectionID === 'providers'" v-model:providers="settingsDraft.providers" />
      <SettingsPlaceholder
        v-else
        :title="selectedSection.label"
        :description="selectedSection.description"
        :icon="selectedSection.icon"
      />
    </section>
  </main>
</template>

<style scoped lang="scss">
/* --- 设置页主容器：左侧导航 + 右侧内容 --- */
.settings-page {
  display: flex;
  width: 100%;
  min-height: 100%;
  background: #0a0a0a;
}

/* --- 右侧内容区：填充剩余空间 --- */
.settings-page__content {
  display: flex;
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
}

/* --- 窄屏适配：纵向堆叠导航和内容 --- */
@media (max-width: 760px) {
  .settings-page { flex-direction: column; }
  .settings-page__content { overflow: visible; }
}
</style>
