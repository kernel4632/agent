<!--
设置页外壳：全屏占用 App 主区，只负责“设置首页 / 设置详情”的切换、草稿保存和关闭。
首页按 pages.js 的 group 显示圆角卡片；点一行进入详情，详情内容仍由各页面包装组件接收 draft。
字段接线和保存逻辑都不在这里：保存统一调用 Settings.save()，关闭仍由 UI.closeSettings() 自动保存。
调用示例：<SettingsPage />；打开首页用 UI.openSettings()，直接进详情用 UI.openSettings('providers')。
-->
<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { AppIcon, Button, IconButton } from '../ui/index.js'
import { groupSettingsPages, settingsPages } from './pages.js'
import { Settings } from '../commands/settings.js'
import { UI } from '../commands/ui.js'
import { store } from '../store.js'

// 当前页只存一份：UI.openSettings(section) 写 store，页面和标题都从它派生。
const selected = computed({
  get: () => store.ui.settingsSection || '',
  set: value => { store.ui.settingsSection = value },
})
const selectedPage = computed(() => {
  const page = settingsPages.find(item => item.id === selected.value)
  return page?.component && !page.disabled ? page : null
})
const groups = computed(() => groupSettingsPages(settingsPages))
const draft = computed(() => store.settings.draft)
const title = computed(() => selectedPage.value?.label || '设置')

// 首页分组来自登记表；新增页面只要写对 group，就会自动出现在对应卡片里。
function openPage(page) {
  if (page.disabled || !page.component) return
  selected.value = page.id
}

// 返回设置首页时先落盘当前页面的修改，避免切换页面时丢掉刚输入的内容。
function goHome() {
  window.clearTimeout(autoSaveTimer)
  void Settings.autoSave()
  selected.value = ''
}

// RikkaHub 的设置是边改边存：停止输入约 600ms 后自动提交，不再需要保存按钮。
let autoSaveTimer = null

function scheduleAutoSave() {
  if (!store.settings.draft) return
  window.clearTimeout(autoSaveTimer)
  autoSaveTimer = window.setTimeout(runAutoSave, 600)
}

async function runAutoSave() {
  autoSaveTimer = null
  await Settings.autoSave()
}

watch(() => store.settings.draft, scheduleAutoSave, { deep: true })

onBeforeUnmount(() => window.clearTimeout(autoSaveTimer))

// 只有返回动作：详情页回到设置首页，首页返回聊天页。关闭时仍会补一次保存。
function goBack() {
  if (selectedPage.value) return goHome()
  void UI.closeSettings()
}
</script>

<template>
  <section class="settings-screen" aria-label="设置">
    <header class="settings-topbar">
      <div class="settings-topbar__inner">
        <div class="settings-topbar__actions">
          <IconButton label="返回" @click="goBack"><AppIcon name="arrow" :size="18" class="settings-back-icon" /></IconButton>
        </div>
        <div class="settings-topbar__heading">
          <h1 :title="title">{{ title }}</h1>
        </div>
      </div>
    </header>

    <div class="settings-scroll">
      <Transition name="settings-view" mode="out-in">
        <!-- 详情页自己可能是多根组件（如模型供应商页），统一包一层单根容器，过渡才有落点。 -->
        <div v-if="selectedPage && draft" :key="selected" class="settings-detail">
          <component :is="selectedPage.component" :draft="draft" />
        </div>

        <div v-else key="home" class="settings-home">
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
        </div>
      </Transition>
    </div>

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
.settings-topbar { flex: none; padding: 12px 24px 0; background: var(--la-bg); }
.settings-topbar__inner { width: 100%; max-width: var(--la-settings-width); margin: 0 auto; }
.settings-topbar__actions { display: flex; min-height: 48px; align-items: center; }
.settings-back-icon { transform: rotate(180deg); }
.settings-topbar__heading { padding: 4px 4px 20px; }
.settings-topbar__heading h1 {
  margin: 0;
  color: var(--la-text);
  font-size: 32px;
  font-weight: 400;
  line-height: 40px;
  letter-spacing: 0;
}
.settings-scroll { min-height: 0; flex: 1; overflow-y: auto; padding: 8px 24px 48px; overscroll-behavior: contain; }
.settings-scroll > * { width: 100%; max-width: var(--la-settings-width); margin-inline: auto; }
.settings-home { display: block; }
.settings-detail { display: block; min-width: 0; }
/* 首页和详情页只做纵向轻移：设置内容可能比视口高，横向移动会摸到滚动边界。 */
.settings-view-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard), transform var(--la-motion-enter) var(--kima-curve-standard); }
.settings-view-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard), transform var(--la-motion-exit) var(--kima-curve-standard); }
.settings-view-enter-from { opacity: 0; transform: translateY(var(--la-motion-rise)); }
.settings-view-leave-to { opacity: 0; transform: translateY(calc(var(--la-motion-rise) * -.75)); }
@media (prefers-reduced-motion: reduce) {
  .settings-view-enter-active, .settings-view-leave-active { transition-duration: .01ms; }
}

/* --- 首页：按 group 排列的圆角卡片和 80px 行 --- */
.settings-group { display: flex; flex-direction: column; gap: 12px; }
.settings-group + .settings-group { margin-top: 24px; }
.settings-group__label {
  margin: 0;
  padding: 0 8px;
  color: var(--la-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  letter-spacing: .02em;
}
.settings-card {
  overflow: hidden;
  border-radius: 24px;
  background: var(--la-layer-01);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
}
.settings-row {
  display: flex;
  width: 100%;
  min-height: 80px;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
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
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  border-radius: 14px;
  background: var(--la-layer-02);
  color: var(--la-secondary);
}
.settings-row__icon--primary { background: color-mix(in srgb, var(--la-accent) 16%, transparent); color: var(--la-accent); }
.settings-row__icon--tertiary { background: color-mix(in srgb, var(--la-success) 16%, transparent); color: var(--la-success); }
.settings-row__icon--secondary { background: color-mix(in srgb, var(--la-warning) 16%, transparent); color: var(--la-warning); }
.settings-row__text { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.settings-row__title {
  overflow: hidden;
  color: var(--la-text);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-row__description {
  overflow: hidden;
  color: var(--la-muted);
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-row__badge {
  flex: none;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--la-layer-02);
  color: var(--la-muted);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}
.settings-row__arrow { flex: none; color: var(--la-muted); }

/* --- 窄屏：全宽和 20px 内边距，行内容只截断不换行 --- */
@media (max-width: 767px) {
  .settings-topbar { padding: 8px 20px 0; }
  .settings-topbar__actions { min-height: 44px; }
  .settings-topbar__heading { padding-bottom: 16px; }
  .settings-topbar__heading h1 { font-size: 28px; line-height: 36px; }
  .settings-scroll { padding: 8px 20px 32px; }
  .settings-row { min-height: 76px; padding: 12px 16px; }
  .settings-row__description { overflow: visible; white-space: normal; }
}
</style>
