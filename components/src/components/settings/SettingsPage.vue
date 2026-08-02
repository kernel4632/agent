<!--
设置页壳：维护整页草稿、分类切换与离开页面自动保存。
具体分类组件只修改草稿，保存时机由本页统一管理。
-->
<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue' // 管理分类选择和可保存的设置草稿
import ProviderSettings from './ProviderSettings.vue' // 供应商配置是当前完整实现的设置分类
import SettingsNavigation from './SettingsNavigation.vue' // 左侧分类导航不持有业务数据
import SettingsPlaceholder from './SettingsPlaceholder.vue' // 其余分类先提供可替换占位内容

const emit = defineEmits(['save']) // 离开设置页时向业务层提交完整设置快照

const sections = [
  { id: 'providers', label: '供应商配置', icon: 'hub', description: '配置模型供应商、凭据与模型能力。' },
  { id: 'tools', label: '工具管理', icon: 'build', description: '管理 Agent 可调用的本地与内置工具。' },
  { id: 'mcp', label: 'MCP 管理', icon: 'dns', description: '连接、启用并诊断 MCP 服务。' },
  { id: 'prompts', label: '系统提示词定义', icon: 'text_snippet', description: '维护系统提示词和可复用规则片段。' },
  { id: 'appearance', label: '语言与外观', icon: 'palette', description: '调整语言、主题、字号与界面密度。' },
  { id: 'data', label: '数据管理', icon: 'database', description: '导入、导出、清理或迁移本地数据。' },
]

const selectedSectionId = ref('providers') // 首次进入设置时展示供应商配置
const selectedSection = computed(() => sections.find(section => section.id === selectedSectionId.value)) // 当前分类供正文复用
const settingsDraft = reactive({           // 所有分类共享同一份显式可追踪草稿
  providers: [
    {
      id: 'openai', name: 'OpenAI', enabled: true,
      apiUrl: 'https://api.openai.com/v1', apiKey: 'sk-proj-••••••••••••',
      models: [
        { id: 'gpt-5.2', name: 'gpt-5.2', capabilities: ['文本', '视觉', '工具'] },
        { id: 'gpt-5-mini', name: 'gpt-5-mini', capabilities: ['文本', '工具'] },
      ],
    },
    {
      id: 'anthropic', name: 'Anthropic', enabled: false,
      apiUrl: 'https://api.anthropic.com', apiKey: '', models: [],
    },
  ],
})

// --- 离开设置页时保存当前草稿快照 ---
function saveSettings() {
  emit('save', structuredClone(settingsDraft)) // 克隆后提交，避免外部继续引用内部响应式数据
}


onBeforeUnmount(saveSettings) // 路由卸载或预览切换都视为离开设置页
</script>

<template>
  <main class="settings-page">
    <SettingsNavigation :items="sections" :selected-id="selectedSectionId" @select="selectedSectionId = $event" />
    <section class="settings-page__content">
      <ProviderSettings v-if="selectedSectionId === 'providers'" v-model:providers="settingsDraft.providers" />
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
.settings-page {
  display: flex;
  width: 100%;
  min-height: 100%;
  background: #0a0a0a;
}

.settings-page__content {
  display: flex;
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
}

@media (max-width: 760px) {
  .settings-page { flex-direction: column; }
  .settings-page__content { overflow: visible; }
}
</style>
