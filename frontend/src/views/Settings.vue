<!--
设置业务视图：加载配置副本，组合模型和权限编辑器，并显式保存用户修改。
提供商和模型在草稿中完整编辑，Server 保存时负责保留未修改的脱敏密钥。
调用示例：App 在 activeView === 'settings' 时渲染 <Settings />。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'        // 引入表单副本、分类标题和首次加载能力
import PermissionEditor from '../components/PermissionEditor.vue' // 引入工具权限编辑器
import ProviderConfig from '../components/ProviderConfig.vue' // 引入模型与提示词编辑器
import CapabilitySettings from '../components/CapabilitySettings.vue' // 引入 MCP、LSP 与 Skills 完整管理器
import { Settings as SettingsCommand } from '../commands/settings.js' // 引入设置草稿和保存指令
import { UI } from '../commands/ui.js'               // 引入设置分类导航指令
import { store } from '../store.js'                       // 引入唯一全局工作台数据

const config = store.config                            // 读取配置状态和保存动作
const ui = store.ui                                    // 读取顶部小窗指定的设置分类
const draft = ref(null)                               // 用户尚未保存的完整配置副本
const providerValid = ref(true)                       // 自定义请求头等提供商字段的当前校验状态
const toolNames = ref([])                             // 设置页展示的当前全部工具名称
const sections = [                                    // Cherry Studio 式全局设置分类
  { id: 'models', label: '模型', description: '供应商、协议与模型目录', icon: 'dns' },
  { id: 'agent', label: 'Agent', description: '系统行为与默认指令', icon: 'settings' },
  { id: 'permissions', label: '权限', description: '工具调用边界与审批策略', icon: 'key' },
  { id: 'mcp', label: 'MCP', description: '连接和管理 MCP 服务', icon: 'hub' },
  { id: 'lsp', label: 'LSP', description: '语言服务器与文件映射', icon: 'code' },
  { id: 'skills', label: '技能', description: 'Agent Skills 安装与开关', icon: 'extension' },
]
const currentSection = computed(() => sections.find((item) => item.id === ui.settingsSection) || sections[0]) // 标题跟随当前分类
const savesCoreConfig = computed(() => !['mcp', 'lsp', 'skills'].includes(ui.settingsSection)) // 外部能力页使用自己的保存并应用流程


// --- 加载配置编辑副本 ---
async function loadConfig() {
  await SettingsCommand.loadPage(draft, toolNames)    // 指令读取配置并写入页面草稿和工具名称
}


// --- 修改权限副本 ---
function setPermissions(permissions) {
  SettingsCommand.setPermissions(draft, permissions)  // 指令将权限编辑结果写入当前草稿
}


// --- 修改系统提示词草稿 ---
function setSystemPrompt(event) {
  SettingsCommand.setSystemPrompt(draft, event.target.value) // 将输入事件交给设置指令修改草稿
}


// --- 修改提供商校验反馈 ---
function setProviderValidity(isValid) {
  SettingsCommand.setProviderValidity(providerValid, isValid) // 将校验结果交给设置指令保存
}


// --- 保存用户配置 ---
async function saveConfig() {
  await SettingsCommand.savePage(draft, providerValid) // 指令校验、保存并用 Server 结果重置草稿
}

onMounted(loadConfig)                                 // 首次进入读取真实设置
</script>

<template>
  <section class="workspace-view settings-view">
    <header class="view-header settings-view__header">
      <div>
        <h1>设置</h1>
        <p>{{ currentSection.description }}</p>
      </div>
      <mdui-button v-if="savesCoreConfig" variant="filled" :disabled="!draft || !providerValid || config.isLoading" @click="saveConfig">保存更改</mdui-button>
    </header>
    <div v-if="config.isSaved" class="notice notice--success">设置已保存并立即生效</div>
    <div v-if="config.errorMessage" class="notice notice--error">{{ config.errorMessage }}</div>
    <div class="settings-layout">
      <nav class="settings-navigation" aria-label="设置分类">
        <button v-for="section in sections" :key="section.id" type="button" :class="{ 'is-active': ui.settingsSection === section.id }" @click="UI.openSettings(section.id)">
          <mdui-icon-dns v-if="section.icon === 'dns'"></mdui-icon-dns>
          <mdui-icon-settings v-else-if="section.icon === 'settings'"></mdui-icon-settings>
          <mdui-icon-key v-else-if="section.icon === 'key'"></mdui-icon-key>
          <mdui-icon-hub v-else-if="section.icon === 'hub'"></mdui-icon-hub>
          <mdui-icon-code v-else-if="section.icon === 'code'"></mdui-icon-code>
          <mdui-icon-extension v-else></mdui-icon-extension>
          <span><strong>{{ section.label }}</strong><small>{{ section.description }}</small></span>
        </button>
      </nav>
      <div class="settings-page">
        <div v-if="config.isLoading && !draft" class="view-loading">正在读取设置…</div>
        <template v-else-if="draft">
          <ProviderConfig v-if="ui.settingsSection === 'models'" v-model="draft" @validity="setProviderValidity" />
          <section v-else-if="ui.settingsSection === 'agent'" class="settings-section settings-section--prompt">
            <header class="settings-section__header"><h2>Agent 行为</h2><p>系统提示词会在下一轮模型调用时生效。</p></header>
            <mdui-text-field class="settings-prompt" label="系统提示词" variant="outlined" autosize :min-rows="5" :value="draft.systemPrompt" @input="setSystemPrompt"></mdui-text-field>
          </section>
          <PermissionEditor v-else-if="ui.settingsSection === 'permissions'" :permissions="draft.permissions || {}" :tool-names="toolNames" @update="setPermissions" />
          <CapabilitySettings v-else embedded :section="ui.settingsSection" />
        </template>
      </div>
    </div>
  </section>
</template>
