<script setup>
import { computed, onMounted, ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import ProviderSettings from './ProviderSettings.vue'
import PromptsSettings from './PromptsSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import { Settings } from '../../commands/settings.js'
import { UI } from '../../commands/ui.js'
import { store } from '../../store.js'

const sections = [
  { id: 'appearance', label: '通用', icon: 'settings' },
  { id: 'providers', label: '模型供应商', icon: 'globe' },
  { id: 'prompts', label: '系统提示词', icon: 'document' },
  { id: 'tools', label: '工具管理', icon: 'code', disabled: true },
  { id: 'mcp', label: 'MCP 服务', icon: 'link', disabled: true },
  { id: 'data', label: '数据管理', icon: 'folder', disabled: true },
]
const dialog = ref(null)
const selected = ref(store.ui.settingsSection)
const section = computed(() => sections.find(item => item.id === selected.value) || sections[0])
const draft = computed(() => store.settings.draft)
onMounted(() => dialog.value.showModal())

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
  <dialog ref="dialog" class="settings-dialog" aria-label="设置" @cancel.prevent="UI.closeSettings()">
    <div class="settings-page">
      <aside class="settings-nav">
        <h2>设置</h2>
        <nav aria-label="设置分类">
          <button v-for="item in sections" :key="item.id" :class="{ active: selected === item.id }" :disabled="item.disabled" :title="item.disabled ? '暂不支持此管理功能' : item.label" :aria-current="selected === item.id ? 'page' : undefined" @click="selected = item.id">
            <AppIcon :name="item.icon" :size="16" /><span>{{ item.label }}</span><small v-if="item.disabled">待支持</small>
          </button>
        </nav>
      </aside>
      <div class="settings-content">
        <header class="settings-heading">
          <h2>{{ section.label }}</h2>
          <button class="icon-button" aria-label="关闭设置" :disabled="store.settings.isSaving" @click="UI.closeSettings()"><AppIcon name="close" :size="20" /></button>
        </header>
        <div v-if="draft" class="settings-body">
          <template v-if="selected === 'providers'">
            <div class="settings-provider-note"><span>管理模型连接</span><button class="button" @click="addProvider"><AppIcon name="plus" :size="14" />添加供应商</button></div>
            <ProviderSettings v-model:providers="draft.providers" />
          </template>
          <PromptsSettings v-else-if="selected === 'prompts'" v-model:prompt="draft.prompt" />
          <AppearanceSettings v-else :appearance="draft.appearance" @change="draft.appearance[$event.field] = $event.value" />
        </div>
        <footer class="settings-footer">
          <span v-if="store.ui.toast" role="status">{{ store.ui.toast }}</span>
          <span v-else>关闭时自动保存</span>
          <button class="button button--primary" :disabled="store.settings.isSaving" @click="save">{{ store.settings.isSaving ? '保存中…' : '保存设置' }}</button>
        </footer>
      </div>
    </div>
  </dialog>
</template>

<style scoped lang="scss">
.settings-dialog {
  width: min(820px, calc(100vw - 48px));
  height: min(660px, calc(100dvh - 64px));
  max-width: none;
  max-height: none;
  padding: 0;
  border: 1px solid var(--la-line);
  border-radius: var(--la-radius-panel);
  background: var(--la-panel);
  color: var(--la-text);
  box-shadow: 0 20px 60px #0006;

  &::backdrop { background: #0007; backdrop-filter: blur(4px); }
}
.settings-page { display: flex; height: 100%; }
.settings-nav {
  flex: 0 0 176px;
  padding: 25px 12px;
  background: var(--la-settings-nav);

  h2 { margin: 0 12px 22px; font-size: 17px; font-weight: 600; }
  nav { display: grid; gap: 4px; }
  button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px 12px; border: 0; border-radius: var(--la-radius); background: transparent; color: var(--la-secondary); text-align: left; font-size: 12px; cursor: pointer; }
  button.active { color: var(--la-text); background: var(--la-setting-row); }
  button:hover:not(:disabled) { background: var(--la-hover); }
  small { margin-left: auto; font-size: 9px; }
}
.settings-content { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.settings-heading { display: flex; flex: none; align-items: center; justify-content: space-between; padding: 20px 24px 12px 28px; }
.settings-heading h2 { margin: 0; font-size: 19px; font-weight: 550; }
.settings-body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 28px 24px; }
.settings-provider-note { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; color: var(--la-secondary); font-size: 12px; }
.settings-footer { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 28px; border-top: 1px solid var(--la-line); color: var(--la-muted); font-size: 11px; }
.settings-footer > span { overflow-wrap: anywhere; }
.settings-footer .button { flex-shrink: 0; }
@media (max-width: 760px) {
  .settings-dialog { width: calc(100vw - 20px); height: calc(100dvh - 28px); }
  .settings-page { flex-direction: column; }
  .settings-nav {
    flex: none;
    padding: 12px;
    h2 { display: none; }
    nav { display: flex; overflow-x: auto; }
    button { width: auto; flex: none; padding: 10px; white-space: nowrap; }
    button:disabled { display: none; }
  }
  .settings-content { min-height: 0; }
  .settings-heading { padding: 14px 16px 8px; }
  .settings-body { padding: 8px 16px 20px; }
  .settings-footer { padding: 12px 16px; }
}
</style>
