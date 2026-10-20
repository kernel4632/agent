<script setup>
import { computed, ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import ProviderSettings from './ProviderSettings.vue'
import PromptsSettings from './PromptsSettings.vue'
import AdvancedSettings from './AdvancedSettings.vue'
import MCPSettings from './MCPSettings.vue'
import ToolsSettings from './ToolsSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import { Settings } from '../../commands/settings.js'
import { UI } from '../../commands/ui.js'
import { store } from '../../store.js'

const sections = [
  { id: 'appearance', label: '通用', icon: 'settings' },
  { id: 'providers', label: '模型供应商', icon: 'globe' },
  { id: 'prompts', label: '系统提示词', icon: 'document' },
  { id: 'advanced', label: '高级', icon: 'code' },
  { id: 'tools', label: '工具管理', icon: 'code' },
  { id: 'mcp', label: 'MCP 服务', icon: 'link' },
  { id: 'data', label: '数据管理', icon: 'folder', disabled: true },
]
const groups = [
  { label: '偏好', ids: ['appearance'] },
  { label: '服务', ids: ['providers', 'prompts', 'advanced', 'tools', 'mcp'] },
  { label: '其他', ids: ['data'] },
].map(group => ({ ...group, items: sections.filter(item => group.ids.includes(item.id)) }))
const selected = ref(store.ui.settingsSection)
const section = computed(() => sections.find(item => item.id === selected.value) || sections[0])
const draft = computed(() => store.settings.draft)

function addProvider() {
  const providers = draft.value.providers
  let number = providers.length + 1
  while (providers.some(item => item.name === `Provider ${number}`)) number += 1
  providers.push({ id: crypto.randomUUID(), name: `Provider ${number}`, enabled: true, apiType: 'openai-compatible', apiUrl: '', apiKey: '', models: [] })
}
async function save() {
  if (await Settings.save()) { Settings.open(); UI.notify('设置已保存') }
}
</script>

<template>
  <section class="settings-screen" aria-label="设置">
    <div class="settings-page">
      <aside class="settings-nav">
        <button class="settings-back" @click="UI.closeSettings()"><AppIcon name="arrow" :size="14" class="settings-back-icon" />返回应用</button>
        <h2>设置</h2>
        <nav aria-label="设置分类">
          <section v-for="group in groups" :key="group.label" class="settings-nav-group">
            <div class="settings-nav-group__label">{{ group.label }}</div>
            <button v-for="item in group.items" :key="item.id" :class="{ active: selected === item.id }" :disabled="item.disabled" :title="item.disabled ? '暂不支持此管理功能' : item.label" :aria-current="selected === item.id ? 'page' : undefined" @click="selected = item.id">
              <AppIcon :name="item.icon" :size="16" /><span>{{ item.label }}</span><small v-if="item.disabled">待支持</small>
            </button>
          </section>
        </nav>
      </aside>
      <div class="settings-content">
        <header class="settings-heading">
          <h2>{{ section.label }}</h2>
          <button class="icon-button" aria-label="关闭设置" :disabled="store.settings.isSaving" @click="UI.closeSettings()"><AppIcon name="close" :size="18" /></button>
        </header>
        <div v-if="draft" class="settings-body">
          <template v-if="selected === 'providers'">
            <div class="settings-provider-note"><span>管理模型连接</span><button class="button" @click="addProvider"><AppIcon name="plus" :size="14" />添加供应商</button></div>
            <ProviderSettings v-model:providers="draft.providers" />
          </template>
          <PromptsSettings v-else-if="selected === 'prompts'" v-model:prompt="draft.prompt" />
          <AdvancedSettings
            v-else-if="selected === 'advanced'"
            v-model:rules="draft.rules"
            v-model:modes="draft.modeDefinitions"
            v-model:diagnostics="draft.diagnostics"
            v-model:snapshot="draft.snapshot"
          />
          <MCPSettings v-else-if="selected === 'mcp'" v-model:mcp="draft.mcp" />
          <ToolsSettings v-else-if="selected === 'tools'" v-model:tools="draft.tools" />
          <AppearanceSettings v-else :appearance="draft.appearance" @change="draft.appearance[$event.field] = $event.value" />
        </div>
        <footer class="settings-footer">
          <span v-if="store.ui.toast" role="status">{{ store.ui.toast }}</span>
          <span v-else>关闭时自动保存</span>
          <button class="button" :disabled="store.settings.isSaving" @click="save">{{ store.settings.isSaving ? '保存中…' : '保存设置' }}</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.settings-screen {
  display: flex;
  flex: 1;
  min-height: 0;
  margin: var(--la-content-inset);
  overflow: hidden;
  border-radius: 10px;
  background: var(--la-panel);
  box-shadow: var(--la-shadow-raised);
  container: settings-screen / inline-size;
}
.settings-page { display: flex; width: 100%; max-width: 1048px; height: 100%; margin: 0 auto; }
.settings-nav {
  display: flex;
  width: 328px;
  min-width: 328px;
  flex: 0 0 328px;
  flex-direction: column;
  gap: 16px;
  padding: 50px 64px 48px 24px;
}
.settings-back {
  display: flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--la-muted);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.settings-back:hover { background: var(--la-layer-03); color: var(--la-text); }
.settings-back-icon { transform: rotate(180deg); }
.settings-nav h2 { margin: 0 6px; color: var(--la-text); font-size: 15px; font-weight: 640; line-height: 20px; }
.settings-nav nav { display: flex; flex-direction: column; gap: 16px; }
.settings-nav-group { display: flex; flex-direction: column; gap: 4px; }
.settings-nav-group__label { display: flex; height: 28px; align-items: center; padding: 0 6px; color: var(--la-muted); font-size: 13px; font-weight: 440; }
.settings-nav nav button {
  display: flex;
  width: 100%;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--la-muted);
  text-align: left;
  font-size: 13px;
  font-weight: 440;
  cursor: pointer;
}
.settings-nav nav button.active { background: var(--la-layer-03); color: var(--la-text); }
.settings-nav nav button:hover:not(:disabled) { background: var(--la-hover); }
.settings-nav small { margin-left: auto; color: var(--la-muted); font-size: 11px; }
.settings-content { display: flex; max-width: 720px; min-width: 0; flex: 1; flex-direction: column; }
.settings-heading {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 48px 0 0;
  background: var(--la-panel);
}
.settings-heading h2 { margin: 0; color: var(--la-text); font-size: 15px; font-weight: 640; line-height: 20px; }
.settings-body { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 32px; overflow-y: auto; padding: 24px 4px 80px; }
.settings-provider-note { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--la-muted); font-size: 13px; }
.settings-footer { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: .5px solid var(--la-line); color: var(--la-muted); font-size: 13px; }
.settings-footer .button { flex-shrink: 0; }
@media (max-width: 1047px) {
  .settings-nav { width: 240px; min-width: 240px; flex-basis: 240px; padding-left: 16px; padding-right: 24px; }
}
@media (max-width: 767px) {
  .settings-page { flex-direction: column; }
  .settings-nav { width: 100%; min-width: 0; flex: none; gap: 4px; padding: 8px 12px; border-bottom: .5px solid var(--la-line); }
  .settings-back { display: none; }
  .settings-nav h2 { display: none; }
  .settings-nav nav { flex-direction: row; gap: 2px; overflow-x: auto; }
  .settings-nav-group { display: contents; }
  .settings-nav-group__label { display: none; }
  .settings-nav nav button { width: auto; flex: none; padding: 0 8px; white-space: nowrap; }
  .settings-nav nav button:disabled { display: none; }
  .settings-content { max-width: none; min-height: 0; }
  .settings-heading { padding: 12px 16px 0; }
  .settings-body { padding: 16px 16px 48px; }
  .settings-footer { padding: 12px 16px; }
}
</style>
