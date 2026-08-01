<!--
设置页：左侧固定分类，右侧展示供应商、工具、MCP、提示词、外观和数据管理。
全部控件修改隔离草稿；用户离开设置页时由 UI 指令自动保存。
调用示例：App 在 ui.view === 'settings' 时渲染 <Settings />。
-->
<script setup>
import { computed, nextTick, ref } from 'vue'                        // 引入设置草稿和移动端滚动反馈
import ProviderConfig from '../components/ProviderConfig.vue'        // 引入双栏供应商管理
import AppearanceSettings from '../components/settings/AppearanceSettings.vue' // 引入外观分类
import DataSettings from '../components/settings/DataSettings.vue'   // 引入数据分类
import McpSettings from '../components/settings/McpSettings.vue'     // 引入 MCP 分类
import PromptSettings from '../components/settings/PromptSettings.vue' // 引入提示词分类
import SettingsNavigation from '../components/settings/SettingsNavigation.vue' // 引入设置分类导航
import ToolSettings from '../components/settings/ToolSettings.vue'   // 引入工具分类
import { Settings as SettingsCommand } from '../commands/settings.js' // 引入设置业务动作
import { UI } from '../commands/ui.js'                               // 引入分类导航
import { t } from '../i18n.js'                                       // 引入响应式界面翻译
import { store } from '../store.js'                                  // 引入设置草稿和反馈

const sections = [                                                    // 严格对应产品设置页结构
  { id: 'providers', label: 'providerConfig', icon: 'dns' },
  { id: 'tools', label: 'toolManagement', icon: 'build' },
  { id: 'mcp', label: 'mcpManagement', icon: 'hub' },
  { id: 'prompt', label: 'promptDefinition', icon: 'smart_toy' },
  { id: 'appearance', label: 'appearance', icon: 'palette' },
  { id: 'data', label: 'dataManagement', icon: 'storage' },
]
const draft = computed(() => store.settings.draft)                    // 当前设置页只消费隔离草稿
const settingsView = ref(null)                                        // 设置分类切换后恢复页面顶部
const defaultToolTitles = { read_file: 'readFile', write_file: 'writeFile', run_command: 'runCommand', web_fetch: 'webFetch', delegate_task: 'delegateTask' } // 默认别名跟随界面语言

function toolTitle(tool) {
  const defaults = { read_file: '读取文件', write_file: '写入文件', run_command: '执行命令', web_fetch: '读取网页', delegate_task: '委派任务' }
  return tool.title === defaults[tool.name] ? t(defaultToolTitles[tool.name]) : tool.title // 用户自定义别名始终保留原文
}


// --- 切换设置分类 ---
async function openSection(sectionID) {
  UI.openSettings(sectionID)                                          // 指令修改当前分类
  await nextTick()                                                     // 等待新分类内容替换完成
  settingsView.value?.scrollTo({ top: 0, behavior: 'smooth' })         // 移动端不继承上一分类的滚动位置
}
</script>

<template>
  <section v-if="draft" ref="settingsView" class="settings-view">
    <SettingsNavigation :sections="sections" :active="store.ui.settingsSection" :saved="Boolean(store.settings.savedAt)" @select="openSection" />

    <main class="settings-content">
      <ProviderConfig v-if="store.ui.settingsSection === 'providers'" :config="draft" />

      <ToolSettings v-else-if="store.ui.settingsSection === 'tools'" :tools="draft.tools" :title-for="toolTitle" @update="SettingsCommand.updateTool" />
      <McpSettings v-else-if="store.ui.settingsSection === 'mcp'" :servers="draft.mcp" @add="SettingsCommand.addMCP" @update="SettingsCommand.updateMCP" @remove="SettingsCommand.removeMCP" />
      <PromptSettings v-else-if="store.ui.settingsSection === 'prompt'" :value="draft.prompt" @update="SettingsCommand.updatePrompt" />
      <AppearanceSettings v-else-if="store.ui.settingsSection === 'appearance'" :appearance="draft.appearance" @update="SettingsCommand.updateAppearance" />
      <DataSettings v-else :feedback="store.settings.feedback" @action="SettingsCommand.dataAction" />
    </main>
  </section>
</template>

<style lang="scss" src="../styles/views/Settings.scss"></style>
