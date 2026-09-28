<script setup>
import './register.js'
import { computed, ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import ProviderSettings from './ProviderSettings.vue'
import PromptsSettings from './PromptsSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import { Settings } from '../../commands/settings.js'
import { UI } from '../../commands/ui.js'
import { store } from '../../store.js'

const sections = [
  { id: 'providers', label: '模型供应商', icon: 'globe', description: '连接你信任的模型，找到适合你的搭档。' },
  { id: 'prompts', label: '系统提示词', icon: 'document', description: '告诉 la 你的偏好，让每次对话更合拍。' },
  { id: 'appearance', label: '外观与通用', icon: 'spark', description: '选择一个让你专注、舒适的工作环境。' },
  { id: 'tools', label: '工具管理', icon: 'code', disabled: true },
  { id: 'mcp', label: 'MCP 服务', icon: 'link', disabled: true },
  { id: 'data', label: '数据管理', icon: 'folder', disabled: true },
]
const selected = ref('providers')
const section = computed(() => sections.find(item => item.id === selected.value))
const draft = computed(() => store.settings.draft)
if (!store.settings.draft) Settings.open()

function addProvider() {
  const providers = draft.value.providers
  let number = providers.length + 1
  while (providers.some(item => item.name === `Provider ${number}`)) number += 1
  providers.push({ id: `provider-${crypto.randomUUID()}`, name: `Provider ${number}`, enabled: true, apiType: 'openai-compatible', apiUrl: '', apiKey: '', models: [] })
}

async function save() {
  if (await Settings.save()) { Settings.open(); UI.notify('设置已保存') }
}
</script>

<template>
  <section class="settings-page" aria-label="设置">
    <aside class="settings-nav"><div class="settings-nav__heading"><span class="eyebrow">MAKE IT YOURS</span><h2>设置与偏好</h2></div><nav aria-label="设置分类"><button v-for="item in sections" :key="item.id" :class="{ active: selected === item.id }" :disabled="item.disabled" :title="item.disabled ? '当前后端未提供此管理功能，暂不可用' : item.label" :aria-current="selected === item.id ? 'page' : undefined" @click="selected = item.id"><AppIcon :name="item.icon" :size="17" /><span>{{ item.label }}</span><small v-if="item.disabled">待支持</small></button></nav><p class="settings-nav__note">未接入的后端能力暂不开放。<br />工具审批仍可在对话中完成。</p></aside>
    <div class="settings-content">
      <header class="settings-heading"><div><h2>{{ section.label }}</h2><p>{{ section.description }}</p></div><button class="button button--primary" :disabled="store.settings.isSaving" @click="save"><AppIcon name="check" :size="16" />{{ store.settings.isSaving ? '保存中…' : '保存设置' }}</button></header>
      <template v-if="draft">
        <div v-if="selected === 'providers'" class="settings-provider-note"><span>API 凭据仅用于连接你配置的服务；不会保存在浏览器存储中。</span><button class="button" @click="addProvider"><AppIcon name="plus" :size="15" />添加供应商</button></div>
        <ProviderSettings v-if="selected === 'providers'" v-model:providers="draft.providers" />
        <PromptsSettings v-else-if="selected === 'prompts'" v-model:prompt="draft.prompt" />
        <AppearanceSettings v-else :appearance="draft.appearance" @change="draft.appearance[$event.field] = $event.value" />
      </template>
      <footer class="settings-save-note"><AppIcon name="info" :size="14" />离开设置时也会保存。外观偏好仅保存在本浏览器。</footer>
    </div>
  </section>
</template>

<style scoped lang="scss">
.settings-page { height: 100%; display: flex; min-width: 0; overflow: hidden; }
.settings-nav { width: 205px; flex: 0 0 205px; border-right: 1px solid var(--la-line); padding: 32px 16px; background: var(--la-hover); }
.settings-nav__heading { padding: 0 12px 25px; }
.settings-nav h2 { font-size: 18px; font-weight: 500; margin: 10px 0 0; }
.settings-nav .eyebrow { font-size: 8px; }
.settings-nav nav { display: grid; gap: 5px; }
.settings-nav button { display: flex; gap: 10px; align-items: center; width: 100%; padding: 13px 12px; border: 1px solid transparent; border-radius: 8px; text-align: left; background: none; color: var(--la-secondary); cursor: pointer; font-size: 12px; }
.settings-nav button.active { color: var(--la-accent); background: var(--la-accent-soft); border-color: var(--la-accent-border); }
.settings-nav button:hover:not(:disabled) { background: var(--la-hover); }
.settings-nav small { margin-left: auto; font-size: 8px; color: var(--la-muted); }
.settings-nav__note { font-size: 9px; line-height: 1.9; color: var(--la-muted); padding: 20px 12px 0; margin-top: 18px; border-top: 1px solid var(--la-line); }
.settings-content { flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; }
.settings-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 31px 30px 24px; border-bottom: 1px solid var(--la-line); }
.settings-heading h2 { font-size: 21px; font-weight: 500; margin: 0 0 10px; }
.settings-heading p { color: var(--la-muted); font-size: 11px; line-height: 1.8; margin: 0; }
.settings-heading .button { flex-shrink: 0; }
.settings-provider-note { padding: 16px 30px; display: flex; gap: 15px; justify-content: space-between; align-items: center; }
.settings-provider-note > span { font-size: 10px; line-height: 1.8; color: var(--la-muted); }
.settings-provider-note .button { flex-shrink: 0; }
.settings-save-note { display: flex; align-items: center; gap: 7px; color: var(--la-muted); font-size: 10px; line-height: 1.8; border-top: 1px solid var(--la-line); padding: 17px 30px; margin-top: auto; }
:deep(.provider-editor) { padding: 24px 26px 40px; gap: 24px; }
:deep(.provider-settings) { flex: none; min-height: 400px; }
@media (max-width: 1100px) { .settings-nav { width: 180px; flex-basis: 180px; padding-inline: 12px; } :deep(.provider-settings) { flex-direction: column; } :deep(.provider-list) { width: 100%; flex-basis: auto; min-height: auto; } }
@media (max-width: 760px) { .settings-page { flex-direction: column; overflow-y: auto; } .settings-nav { width: 100%; flex: none; padding: 12px 16px; border-right: 0; border-bottom: 1px solid var(--la-line); } .settings-nav__heading, .settings-nav__note { display: none; } .settings-nav nav { display: flex; overflow-x: auto; gap: 6px; padding: 2px; } .settings-nav button { width: auto; white-space: nowrap; padding: 10px 12px; } .settings-nav button:disabled { display: none; } .settings-content { overflow: visible; flex: none; } .settings-heading { padding: 22px 20px; gap: 10px; } .settings-heading h2 { font-size: 19px; } .settings-heading p { font-size: 10px; } .settings-provider-note { padding: 14px 20px; flex-wrap: wrap; } .settings-save-note { padding: 16px 20px; } :deep(.provider-editor) { padding: 22px 20px 32px; } }
</style>
