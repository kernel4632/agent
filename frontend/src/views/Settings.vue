<!--
设置页：左侧固定分类，右侧展示供应商、工具、MCP、提示词、外观和数据管理。
全部控件修改隔离草稿；用户离开设置页时由 UI 指令自动保存。
调用示例：App 在 ui.view === 'settings' 时渲染 <Settings />。
-->
<script setup>
import { computed } from 'vue'                                       // 引入当前设置分类标题
import ProviderConfig from '../components/ProviderConfig.vue'        // 引入双栏供应商管理
import { Settings as SettingsCommand } from '../commands/settings.js' // 引入设置业务动作
import { UI } from '../commands/ui.js'                               // 引入分类导航
import { t } from '../i18n.js'                                       // 引入响应式界面翻译
import { store } from '../store.js'                                  // 引入设置草稿和反馈

const sections = [                                                    // 严格对应产品设置页结构
  { id: 'providers', label: 'providerConfig', icon: 'dns' },
  { id: 'tools', label: 'toolManagement', icon: 'build' },
  { id: 'mcp', label: 'mcpManagement', icon: 'hub' },
  { id: 'prompt', label: 'promptDefinition', icon: 'smart-toy' },
  { id: 'appearance', label: 'appearance', icon: 'palette' },
  { id: 'data', label: 'dataManagement', icon: 'storage' },
]
const draft = computed(() => store.settings.draft)                    // 当前设置页只消费隔离草稿
const currentSection = computed(() => sections.find((section) => section.id === store.ui.settingsSection) || sections[0]) // 顶栏标题跟随导航
const defaultToolTitles = { read_file: 'readFile', write_file: 'writeFile', run_command: 'runCommand', web_fetch: 'webFetch', delegate_task: 'delegateTask' } // 默认别名跟随界面语言

function toolTitle(tool) {
  const defaults = { read_file: '读取文件', write_file: '写入文件', run_command: '执行命令', web_fetch: '读取网页', delegate_task: '委派任务' }
  return tool.title === defaults[tool.name] ? t(defaultToolTitles[tool.name]) : tool.title // 用户自定义别名始终保留原文
}


// --- 添加 MCP ---
function addMCP() {
  SettingsCommand.addMCP()                                            // 新连接直接进入草稿列表末尾
}
</script>

<template>
  <section v-if="draft" class="settings-view">
    <aside class="settings-nav">
      <header><h1>{{ t('settings') }}</h1><small v-if="store.settings.savedAt">{{ t('autoSaved') }}</small></header>
      <mdui-button v-for="section in sections" :key="section.id" variant="text" full-width :class="{ 'is-active': store.ui.settingsSection === section.id }" @click="UI.openSettings(section.id)">
        <mdui-icon-dns v-if="section.icon === 'dns'" slot="icon"></mdui-icon-dns>
        <mdui-icon-build v-else-if="section.icon === 'build'" slot="icon"></mdui-icon-build>
        <mdui-icon-hub v-else-if="section.icon === 'hub'" slot="icon"></mdui-icon-hub>
        <mdui-icon-smart-toy v-else-if="section.icon === 'smart-toy'" slot="icon"></mdui-icon-smart-toy>
        <mdui-icon-palette v-else-if="section.icon === 'palette'" slot="icon"></mdui-icon-palette>
        <mdui-icon-storage v-else slot="icon"></mdui-icon-storage>
        <span>{{ t(section.label) }}</span>
      </mdui-button>
      <footer>{{ t('autoSaveOnLeave') }}</footer>
    </aside>

    <main class="settings-content">
      <header class="settings-content__header"><div><h2>{{ t(currentSection.label) }}</h2><p>{{ t('draftFeedback') }}</p></div></header>

      <ProviderConfig v-if="store.ui.settingsSection === 'providers'" :config="draft" />

      <section v-else-if="store.ui.settingsSection === 'tools'" class="simple-settings">
        <header class="simple-settings__heading"><div><h3>{{ t('tools') }}</h3><p>{{ t('toolsDescription') }}</p></div><span>{{ draft.tools.length }}</span></header>
        <mdui-card v-for="tool in draft.tools" :key="tool.name" variant="filled" class="tool-setting-row">
          <mdui-avatar class="tool-setting-row__symbol"><mdui-icon-build></mdui-icon-build></mdui-avatar>
          <div><mdui-text-field variant="filled" :value="toolTitle(tool)" :label="t('toolAlias')" @input="SettingsCommand.updateTool(tool.name, { title: $event.target.value })"></mdui-text-field><small>{{ tool.name }} · {{ tool.source === '内置' ? t('builtIn') : tool.source }}</small></div>
          <mdui-select variant="filled" :value="tool.permission" :label="t('toolPermission')" @change="SettingsCommand.updateTool(tool.name, { permission: $event.target.value })"><mdui-menu-item value="allow">{{ t('allow') }}</mdui-menu-item><mdui-menu-item value="ask">{{ t('ask') }}</mdui-menu-item><mdui-menu-item value="deny">{{ t('deny') }}</mdui-menu-item></mdui-select>
          <mdui-switch :checked="tool.enabled" @change="SettingsCommand.updateTool(tool.name, { enabled: $event.target.checked })"></mdui-switch>
        </mdui-card>
      </section>

      <section v-else-if="store.ui.settingsSection === 'mcp'" class="simple-settings">
        <header class="simple-settings__heading"><div><h3>{{ t('mcpServices') }}</h3><p>{{ t('mcpDescription') }}</p></div><mdui-button variant="tonal" @click="addMCP"><mdui-icon-add slot="icon"></mdui-icon-add>{{ t('addMcp') }}</mdui-button></header>
        <mdui-card v-for="server in draft.mcp" :key="server.id" variant="filled" class="mcp-setting">
          <div class="mcp-setting__top"><span :class="`is-${server.status}`"></span><mdui-text-field variant="filled" :value="server.name" :label="t('mcpName')" @input="SettingsCommand.updateMCP(server.id, { name: $event.target.value })"></mdui-text-field><small>{{ t('toolCount', { count: server.toolCount }) }}</small><mdui-switch :checked="server.enabled" @change="SettingsCommand.updateMCP(server.id, { enabled: $event.target.checked })"></mdui-switch><mdui-button-icon class="icon-command" :aria-label="t('deleteMcp')" @click="SettingsCommand.removeMCP(server.id)"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon></div>
          <mdui-text-field variant="outlined" :value="server.command" :label="t('launchCommand')" @input="SettingsCommand.updateMCP(server.id, { command: $event.target.value })"></mdui-text-field>
        </mdui-card>
        <div v-if="!draft.mcp.length" class="empty-state">{{ t('noMcp') }}</div>
      </section>

      <section v-else-if="store.ui.settingsSection === 'prompt'" class="simple-settings prompt-settings">
        <header class="simple-settings__heading"><div><h3>{{ t('globalPrompt') }}</h3><p>{{ t('promptDescription') }}</p></div></header>
        <mdui-text-field variant="outlined" autosize :min-rows="10" :max-rows="20" :value="draft.prompt" :label="t('globalPrompt')" @input="draft.prompt = $event.target.value"></mdui-text-field>
        <small>{{ t('characterCount', { count: draft.prompt.length }) }}</small>
      </section>

      <section v-else-if="store.ui.settingsSection === 'appearance'" class="simple-settings">
        <header class="simple-settings__heading"><div><h3>{{ t('appearance') }}</h3><p>{{ t('appearanceDescription') }}</p></div></header>
        <mdui-select variant="outlined" :value="draft.appearance.language" :label="t('interfaceLanguage')" @change="draft.appearance.language = $event.target.value"><mdui-menu-item value="zh-CN">{{ t('simplifiedChinese') }}</mdui-menu-item><mdui-menu-item value="en-US">English</mdui-menu-item></mdui-select>
        <mdui-select variant="outlined" :value="draft.appearance.density" :label="t('interfaceDensity')" @change="draft.appearance.density = $event.target.value"><mdui-menu-item value="comfortable">{{ t('comfortable') }}</mdui-menu-item><mdui-menu-item value="compact">{{ t('compact') }}</mdui-menu-item></mdui-select>
        <label class="switch-field"><span><strong>{{ t('animations') }}</strong><small>{{ t('animationsDescription') }}</small></span><mdui-switch :checked="draft.appearance.animations" @change="draft.appearance.animations = $event.target.checked"></mdui-switch></label>
      </section>

      <section v-else class="simple-settings data-settings">
        <header class="simple-settings__heading"><div><h3>{{ t('dataManagement') }}</h3><p>{{ t('dataDescription') }}</p></div></header>
        <mdui-card variant="filled"><mdui-avatar><mdui-icon-download></mdui-icon-download></mdui-avatar><div><strong>{{ t('exportData') }}</strong><small>{{ t('exportDescription') }}</small></div><mdui-button variant="tonal" @click="SettingsCommand.dataAction('export')">{{ t('export') }}</mdui-button></mdui-card>
        <mdui-card variant="filled"><mdui-avatar><mdui-icon-upload></mdui-icon-upload></mdui-avatar><div><strong>{{ t('importData') }}</strong><small>{{ t('importDescription') }}</small></div><mdui-button variant="tonal" @click="SettingsCommand.dataAction('import')">{{ t('import') }}</mdui-button></mdui-card>
        <mdui-card variant="filled" class="is-danger"><mdui-avatar><mdui-icon-delete></mdui-icon-delete></mdui-avatar><div><strong>{{ t('clearData') }}</strong><small>{{ t('clearDescription') }}</small></div><mdui-button variant="outlined" @click="SettingsCommand.dataAction('clear')">{{ t('clear') }}</mdui-button></mdui-card>
        <div v-if="store.settings.feedback" class="inline-feedback">{{ store.settings.feedback }}</div>
      </section>
    </main>
  </section>
</template>

<style lang="scss" src="../styles/views/Settings.scss"></style>
