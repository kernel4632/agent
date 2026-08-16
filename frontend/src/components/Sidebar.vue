<!--
通用应用侧边栏：提供产品入口、主操作、会话切换和设置入口，不包含页面跳转逻辑。
调用方通过 v-model:collapsed 控制展开状态，并通过事件处理每个导航动作。
调用示例：<Sidebar :conversations="conversations" @select-conversation="openConversation" />。
-->
<script setup>
import { HugeiconsIcon } from '@hugeicons/vue'
import { Home01Icon, PencilEdit01Icon, Cancel01Icon, ArrowLeftDoubleIcon, ArrowRightDoubleIcon, Settings01Icon } from '@hugeicons/core-free-icons'
import { ICON_STROKE_WIDTH } from '../theme.js'

const collapsed = defineModel('collapsed', { type: Boolean, default: false })
const props = defineProps({
  conversations: { type: Array, default: () => [] },
  activeConversationId: { type: [String, Number], default: null },
  activeView: { type: String, default: 'home' },
})
const emit = defineEmits(['home', 'new-conversation', 'select-conversation', 'close-conversation', 'settings'])

function toggleSidebar() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <aside class="sidebar" :class="{ 'is-collapsed': collapsed }" aria-label="侧边栏">
    <header class="sidebar__header">
      <button class="sidebar__logo" type="button" aria-label="产品首页" @click="emit('home')">
        <slot name="logo"><span class="sidebar__logo-mark">A</span></slot>
      </button>
      <m3e-icon-button v-if="!collapsed" class="sidebar__toggle" type="button" shape="rounded" aria-label="收起侧边栏" aria-expanded="true" title="收起侧边栏" @click="toggleSidebar">
        <HugeiconsIcon :icon="ArrowLeftDoubleIcon" :stroke-width="ICON_STROKE_WIDTH" />
      </m3e-icon-button>
    </header>

    <m3e-nav-menu v-if="!collapsed" class="sidebar__actions" aria-label="主要操作">
      <m3e-nav-menu-item aria-label="主页" :selected="props.activeView === 'home'" :title="collapsed ? '主页' : undefined" @click="emit('home')">
        <HugeiconsIcon slot="icon" :icon="Home01Icon" :stroke-width="ICON_STROKE_WIDTH" />
        <span slot="label">主页</span>
      </m3e-nav-menu-item>
      <m3e-nav-menu-item aria-label="新建对话" :title="collapsed ? '新建对话' : undefined" @click="emit('new-conversation')">
        <HugeiconsIcon slot="icon" :icon="PencilEdit01Icon" :stroke-width="ICON_STROKE_WIDTH" />
        <span slot="label">新建对话</span>
      </m3e-nav-menu-item>
    </m3e-nav-menu>

    <m3e-nav-rail v-else class="sidebar__rail" aria-label="主要操作">
      <m3e-nav-item aria-label="主页" :selected="props.activeView === 'home'" @click="emit('home')">
        <HugeiconsIcon slot="icon" :icon="Home01Icon" :stroke-width="ICON_STROKE_WIDTH" />
        主页
      </m3e-nav-item>
      <m3e-nav-item aria-label="新建对话" @click="emit('new-conversation')">
        <HugeiconsIcon slot="icon" :icon="PencilEdit01Icon" :stroke-width="ICON_STROKE_WIDTH" />
        新建
      </m3e-nav-item>
      <m3e-nav-item aria-label="设置" :selected="props.activeView === 'settings'" @click="emit('settings')">
        <HugeiconsIcon slot="icon" :icon="Settings01Icon" :stroke-width="ICON_STROKE_WIDTH" />
        设置
      </m3e-nav-item>
    </m3e-nav-rail>

    <m3e-nav-menu v-if="!collapsed" class="sidebar__conversations" aria-label="会话列表">
      <m3e-nav-menu-item
        v-for="conversation in props.conversations"
        :key="conversation.id"
        class="sidebar__conversation-row"
        :selected="conversation.id === props.activeConversationId"
        @click="emit('select-conversation', conversation.id)"
      >
        <span slot="label" class="sidebar__conversation-title">{{ conversation.title || '新对话' }}</span>
        <m3e-icon-button slot="badge" class="sidebar__conversation-close" type="button" shape="rounded" aria-label="关闭会话" title="关闭" @click.stop="emit('close-conversation', conversation.id)">
          <HugeiconsIcon :icon="Cancel01Icon" :stroke-width="ICON_STROKE_WIDTH" />
        </m3e-icon-button>
      </m3e-nav-menu-item>
    </m3e-nav-menu>

    <m3e-icon-button v-if="collapsed" class="sidebar__expand" type="button" shape="rounded" aria-label="展开侧边栏" aria-expanded="false" title="展开侧边栏" @click="toggleSidebar">
      <HugeiconsIcon :icon="ArrowRightDoubleIcon" :stroke-width="ICON_STROKE_WIDTH" />
    </m3e-icon-button>

    <footer v-if="!collapsed" class="sidebar__footer">
      <m3e-divider></m3e-divider>
      <m3e-nav-menu class="sidebar__settings-menu">
        <m3e-nav-menu-item class="sidebar__settings" aria-label="设置" :selected="props.activeView === 'settings'" :title="collapsed ? '设置' : undefined" @click="emit('settings')">
          <HugeiconsIcon slot="icon" :icon="Settings01Icon" :stroke-width="ICON_STROKE_WIDTH" />
          <span slot="label">设置</span>
        </m3e-nav-menu-item>
      </m3e-nav-menu>
    </footer>
  </aside>
</template>

<style scoped lang="scss">

/* --- 侧边栏主容器：展开/收起由 CSS 变量切换宽度 --- */
.sidebar {
  --sidebar-width: 270px;
  --sidebar-inset: 14px;
  --sidebar-item-height: 48px;
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  height: 100%;
  min-height: 440px;
  overflow: hidden;
  border-right: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 14px 0 0 14px;
  background: var(--md-sys-color-surface-container-lowest);
  color: var(--md-sys-color-on-surface);
  transition: width var(--motion-duration-spring) var(--motion-spring-bouncy);

  &.is-collapsed {
    --sidebar-width: 76px;                                            /* 收起态只保留图标宽度 */
    --sidebar-inset: 9px;
  }
}

/* --- 顶部标题栏：Logo + 收起按钮 --- */
.sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 76px;
  padding: 10px 19px;
}

/* --- Logo 按钮：圆形产品标识 --- */
.sidebar__logo {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  cursor: pointer;
}

/* --- 所有可交互元素的弹性交互反馈 --- */
.sidebar__logo,
.sidebar__toggle,
.sidebar__expand {
  @include bounce-interact;
  transition: transform var(--motion-duration-spring) var(--motion-spring-bouncy), filter 120ms ease, background-color 120ms ease, color 120ms ease;

  &:active { transform: scale(.96); }                                 /* 侧边栏元素缩小幅度比全局稍大 */
}

/* --- Logo 圆形标记 --- */
.sidebar__logo-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 3px solid currentcolor;
  border-radius: 50% 50%;
  font-size: 16px;
  font-weight: 800;
  transform: rotate(-8deg);                                          /* 微倾斜增加辨识度 */
}

/* --- 收起/展开切换按钮 --- */
.sidebar__toggle,
.sidebar__expand {
  --m3e-icon-button-icon-color: var(--md-sys-color-outline);
  --m3e-icon-button-hover-icon-color: var(--md-sys-color-on-surface);
  width: 40px;
  height: 40px;

  m3e-icon { font-size: 24px; }
}

/* --- 主操作区：主页和新建对话 --- */
.sidebar__actions {
  flex: 0 0 auto;
  padding: 10px var(--sidebar-inset) 8px;
}

.sidebar__rail {
  min-height: 0;
  flex: 1 1 auto;
}

/* --- 会话列表滚动区 --- */
.sidebar__conversations {
  min-height: 0;
  padding: 16px var(--sidebar-inset);
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1 1 auto;
  scrollbar-width: thin;
  scrollbar-color: var(--md-sys-color-outline-variant) transparent;
}

/* --- 单个会话行：标题在左，关闭按钮在右 --- */
.sidebar__conversation-row {
  &:hover .sidebar__conversation-close {
    opacity: 1;
    pointer-events: auto;
  }
}

/* --- 会话标题：左侧自适应宽度，溢出截断 --- */
.sidebar__conversation-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  color: var(--md-sys-color-on-surface-variant);
}

/* --- 关闭按钮：右侧固定，悬停行时显示 --- */
.sidebar__conversation-close {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;

  m3e-icon { font-size: 14px; }
}

/* --- 收起态展开按钮 --- */
.sidebar__expand {
  flex: 0 0 40px;
  margin: auto auto 16px;
}

/* --- 底部设置区：分割线 + 设置入口 --- */
.sidebar__footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 auto;
  padding: 0 var(--sidebar-inset) 12px;

  m3e-divider {
    --m3e-divider-color: var(--md-sys-color-outline-variant);
  }
}

.sidebar__settings {
  width: 100%;
}

/* --- 收起态：所有按钮居中显示为纯图标 --- */
.sidebar.is-collapsed {
  .sidebar__header {
    justify-content: center;
    padding-inline: 16px;
  }

}

/* --- 无障碍：关闭动画的降级 --- */
@media (prefers-reduced-motion: reduce) {
  .sidebar { transition-duration: 1ms; }
}
</style>
