<!--
设置页外壳：只负责页面布局、当前分类、草稿保存和关闭，不包含任何具体设置控件。
导航来自 SettingsNav，页面内容来自 pages.js 登记表，具体字段接线由各页面包装组件负责。
调用示例：<SettingsPage />；打开设置用 UI.openSettings('providers')。
-->
<script setup>
import { computed, ref } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import Button from '../ui/Button.vue'
import IconButton from '../ui/IconButton.vue'
import SettingsNav from './SettingsNav.vue'
import { settingsPages } from './pages.js'
import { Settings } from '../commands/settings.js'
import { UI } from '../commands/ui.js'
import { store } from '../store.js'

const selected = ref(store.ui.settingsSection)
const currentPage = computed(() => settingsPages.find(page => page.id === selected.value) || settingsPages[0])
const draft = computed(() => store.settings.draft)

function selectPage(id) {
  selected.value = id
}

async function save() {
  if (await Settings.save()) { Settings.open(); UI.notify('设置已保存') }
}
</script>

<template>
  <section class="settings-screen" aria-label="设置">
    <div class="settings-page">
      <SettingsNav :pages="settingsPages" :active-id="selected" @select="selectPage" @back="UI.closeSettings()" />
      <div class="settings-content">
        <header class="settings-heading">
          <h2>{{ currentPage.label }}</h2>
          <IconButton label="关闭设置" :disabled="store.settings.isSaving" @click="UI.closeSettings()"><AppIcon name="close" :size="18" /></IconButton>
        </header>
        <div v-if="draft" class="settings-body">
          <component :is="currentPage.component" v-if="currentPage.component" :draft="draft" />
        </div>
        <footer class="settings-footer">
          <span v-if="store.ui.toast" role="status">{{ store.ui.toast }}</span>
          <span v-else>关闭时自动保存</span>
          <Button :disabled="store.settings.isSaving" @click="save">{{ store.settings.isSaving ? '保存中…' : '保存设置' }}</Button>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
/* --- 设置页外壳 --- */
.settings-screen {
  display: flex;
  flex: 1;
  min-height: 0;
  margin: var(--la-content-inset);
  overflow: hidden;
  border-radius: var(--la-radius-panel);
  background: var(--la-panel);
  box-shadow: var(--la-shadow-raised);
  container: settings-screen / inline-size;
}
.settings-page { display: flex; width: 100%; max-width: var(--la-settings-page-width); height: 100%; margin: 0 auto; }

/* --- 内容区、标题和保存栏 --- */
.settings-content { display: flex; max-width: var(--la-settings-content-width); min-width: 0; flex: 1; flex-direction: column; }
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
.settings-footer { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: .5px solid var(--la-line); color: var(--la-muted); font-size: 13px; }
.settings-footer .button { flex-shrink: 0; }

/* --- 窄屏：导航变成顶部横条，内容区占满剩余高度 --- */
@media (max-width: 799px) {
  .settings-page { flex-direction: column; }
  .settings-content { max-width: none; min-height: 0; }
  .settings-heading { padding: 12px 16px 0; }
  .settings-body { padding: 16px 16px 48px; }
  .settings-footer { padding: 12px 16px; }
}
</style>
