<!--
设置页外壳：全屏占用 App 主区，只负责“设置首页 / 设置详情”的切换、草稿保存和关闭。
首页按 pages.js 的 group 显示圆角卡片；点一行进入详情，详情内容仍由各页面包装组件接收 draft。
字段接线和保存逻辑都不在这里：保存统一调用 Settings.save()，关闭仍由 UI.closeSettings() 自动保存。
调用示例：<SettingsPage />；打开首页用 UI.openSettings()，直接进详情用 UI.openSettings('providers')。
-->
<script setup>
import { computed, ref } from 'vue'
import { AppIcon, Button, IconButton } from '../ui/index.js'
import { groupSettingsPages, settingsPages } from './pages.js'
import { Settings } from '../commands/settings.js'
import { UI } from '../commands/ui.js'
import { store } from '../store.js'

// 打开设置时只有明确传入了页面 id 才进入详情；否则停在设置首页，不默认选“通用”。
const initialPage = settingsPages.find(page => page.id === store.ui.settingsSection && page.component && !page.disabled)
const selected = ref(initialPage ? initialPage.id : '')
const selectedPage = computed(() => settingsPages.find(page => page.id === selected.value) || null)
const groups = computed(() => groupSettingsPages(settingsPages))
const draft = computed(() => store.settings.draft)
const title = computed(() => selectedPage.value?.label || '设置')

// 首页分组来自登记表；新增页面只要写对 group，就会自动出现在对应卡片里。
function openPage(page) {
  if (page.disabled || !page.component) return
  selected.value = page.id
  store.ui.settingsSection = page.id
}

// 返回只回到设置首页，不关闭设置；关闭仍走 UI.closeSettings()，保留自动保存。
function goHome() {
  selected.value = ''
  store.ui.settingsSection = ''
}

// 保存成功后重新打开一份草稿，让详情页可以继续修改；toast 文案保持原样。
async function save() {
  if (await Settings.save()) { Settings.open(); UI.notify('设置已保存') }
}
</script>

<template>
  <section class="settings-screen" aria-label="设置">
    <header class="settings-topbar">
      <div class="settings-topbar__inner">
        <div class="settings-topbar__actions">
          <IconButton v-if="selectedPage" label="返回设置" @click="goHome"><AppIcon name="arrow" :size="18" class="settings-back-icon" /></IconButton>
          <IconButton class="settings-topbar__close" label="关闭设置" :disabled="store.settings.isSaving" @click="UI.closeSettings()"><AppIcon name="close" :size="18" /></IconButton>
        </div>
        <div class="settings-topbar__heading">
          <h1 :title="title">{{ title }}</h1>
          <p v-if="!selectedPage">外观、模型、工具和扩展</p>
        </div>
      </div>
    </header>

    <div class="settings-scroll">
      <template v-if="selectedPage">
        <component v-if="draft" :is="selectedPage.component" :draft="draft" />
      </template>

      <template v-else>
        <section v-for="group in groups" :key="group.label" class="settings-group">
          <h2 class="settings-group__label">{{ group.label }}</h2>
          <div class="settings-card">
            <Button
              v-for="page in group.items"
              :key="page.id"
              variant="plain"
              class="settings-row"
              :disabled="page.disabled"
              :title="page.disabled ? '暂不支持此管理功能' : undefined"
              @click="openPage(page)"
            >
              <span class="settings-row__icon" :class="`settings-row__icon--${page.tone || 'secondary'}`" aria-hidden="true">
                <AppIcon :name="page.icon" :size="20" />
              </span>
              <span class="settings-row__text">
                <span class="settings-row__title">{{ page.label }}</span>
                <span class="settings-row__description">{{ page.description }}</span>
              </span>
              <span v-if="page.disabled" class="settings-row__badge">待支持</span>
              <AppIcon name="arrow" :size="16" class="settings-row__arrow" aria-hidden="true" />
            </Button>
          </div>
        </section>
      </template>
    </div>

    <footer v-if="selectedPage" class="settings-footer">
      <div class="settings-footer__inner">
        <span v-if="store.ui.toast" class="settings-footer__note" role="status">{{ store.ui.toast }}</span>
        <span v-else class="settings-footer__note">关闭时自动保存</span>
        <Button variant="primary" :disabled="store.settings.isSaving" @click="save">{{ store.settings.isSaving ? '保存中…' : '保存设置' }}</Button>
      </div>
    </footer>
  </section>
</template>

<style scoped lang="scss">
/* --- 全屏外壳：顶部大标题栏 + 可滚动内容 + 详情保存栏 --- */
.settings-screen {
  display: flex;
  width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  color: var(--la-text);
  background: var(--la-bg);
}
.settings-topbar { flex: none; padding: 8px 16px 0; background: var(--la-bg); }
.settings-topbar__inner, .settings-footer__inner { width: 100%; max-width: var(--la-settings-width); margin: 0 auto; }
.settings-topbar__actions { display: flex; min-height: 40px; align-items: center; }
.settings-topbar__close { margin-left: auto; }
.settings-back-icon { transform: rotate(180deg); }
.settings-topbar__heading { padding: 2px 2px 14px; }
.settings-topbar__heading h1 {
  margin: 0;
  color: var(--la-text);
  font-size: 32px;
  font-weight: 700;
  line-height: 40px;
  letter-spacing: -.5px;
}
.settings-topbar__heading p { margin: 4px 0 0; color: var(--la-muted); font-size: 13px; font-weight: 440; line-height: 19px; }
.settings-scroll { min-height: 0; flex: 1; overflow-y: auto; padding: 4px 16px 32px; overscroll-behavior: contain; }
.settings-scroll > * { width: 100%; max-width: var(--la-settings-width); margin-inline: auto; }

/* --- 首页：按 group 排列的圆角卡片和 64px 行 --- */
.settings-group { display: flex; flex-direction: column; gap: 8px; }
.settings-group + .settings-group { margin-top: 24px; }
.settings-group__label {
  margin: 0;
  padding: 0 4px;
  color: var(--la-muted);
  font-size: 12px;
  font-weight: 640;
  line-height: 18px;
  letter-spacing: .04em;
}
.settings-card {
  overflow: hidden;
  border-radius: 20px;
  background: var(--la-layer-01);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
}
.settings-row {
  display: flex;
  width: 100%;
  min-height: 64px;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--la-text);
  text-align: left;
  cursor: pointer;
}
.settings-row + .settings-row { border-top: .5px solid var(--la-line); }
.settings-row:hover:not(:disabled) { background: var(--la-hover); }
.settings-row:focus-visible { position: relative; z-index: 1; outline-offset: -2px; }
.settings-row__icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-radius: 12px;
  background: var(--la-layer-02);
  color: var(--la-secondary);
}
.settings-row__icon--primary { background: color-mix(in srgb, var(--la-accent) 16%, transparent); color: var(--la-accent); }
.settings-row__icon--tertiary { background: color-mix(in srgb, var(--la-success) 16%, transparent); color: var(--la-success); }
.settings-row__icon--secondary { background: color-mix(in srgb, var(--la-warning) 16%, transparent); color: var(--la-warning); }
.settings-row__text { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
.settings-row__title {
  overflow: hidden;
  color: var(--la-text);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-row__description {
  overflow: hidden;
  color: var(--la-muted);
  font-size: 12px;
  font-weight: 440;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-row__badge {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--la-layer-02);
  color: var(--la-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
}
.settings-row__arrow { flex: none; color: var(--la-muted); }

/* --- 详情：现有页面组件 + 底部保存栏 --- */
.settings-footer { flex: none; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: .5px solid var(--la-line); background: var(--la-bg); }
.settings-footer__inner { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.settings-footer__note { min-width: 0; overflow: hidden; color: var(--la-muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.settings-footer .button { flex-shrink: 0; }

/* --- 窄屏：全宽、16px 内边距，行内容只截断不换行 --- */
@media (max-width: 767px) {
  .settings-topbar { padding-top: 4px; }
  .settings-topbar__actions { min-height: 36px; }
  .settings-topbar__heading { padding-bottom: 12px; }
  .settings-topbar__heading h1 { font-size: 28px; line-height: 36px; }
  .settings-scroll { padding-bottom: 24px; }
}
</style>
