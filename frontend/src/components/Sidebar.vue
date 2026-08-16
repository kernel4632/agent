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

    <nav class="sidebar__actions" aria-label="主要操作">
      <m3e-button class="sidebar__action" type="button" shape="square" aria-label="主页" :title="collapsed ? '主页' : undefined" @click="emit('home')">
        <span class="sidebar__action-content">
          <HugeiconsIcon :icon="Home01Icon" :stroke-width="ICON_STROKE_WIDTH" />
          <span class="sidebar__label">主页</span>
        </span>
      </m3e-button>
      <m3e-button class="sidebar__action is-primary" type="button" variant="tonal" shape="square" aria-label="新建对话" :title="collapsed ? '新建对话' : undefined" @click="emit('new-conversation')">
        <span class="sidebar__action-content">
          <HugeiconsIcon :icon="PencilEdit01Icon" :stroke-width="ICON_STROKE_WIDTH" />
          <span class="sidebar__label">新建对话</span>
        </span>
      </m3e-button>
    </nav>

    <section v-if="!collapsed" class="sidebar__conversations" aria-label="会话列表">
      <div
        v-for="conversation in props.conversations"
        :key="conversation.id"
        class="sidebar__conversation-row"
        :class="{ 'is-active': conversation.id === props.activeConversationId }"
        @click="emit('select-conversation', conversation.id)"
      >
        <span class="sidebar__conversation-title">{{ conversation.title || '新对话' }}</span>
        <m3e-icon-button class="sidebar__conversation-close" type="button" shape="rounded" aria-label="关闭会话" title="关闭" @click.stop="emit('close-conversation', conversation.id)">
          <HugeiconsIcon :icon="Cancel01Icon" :stroke-width="ICON_STROKE_WIDTH" />
        </m3e-icon-button>
      </div>
    </section>

    <m3e-icon-button v-if="collapsed" class="sidebar__expand" type="button" shape="rounded" aria-label="展开侧边栏" aria-expanded="false" title="展开侧边栏" @click="toggleSidebar">
      <HugeiconsIcon :icon="ArrowRightDoubleIcon" :stroke-width="ICON_STROKE_WIDTH" />
    </m3e-icon-button>

    <footer class="sidebar__footer">
      <m3e-divider></m3e-divider>
      <m3e-button class="sidebar__settings" type="button" shape="square" aria-label="设置" :title="collapsed ? '设置' : undefined" @click="emit('settings')">
        <span class="sidebar__action-content">
          <HugeiconsIcon :icon="Settings01Icon" :stroke-width="ICON_STROKE_WIDTH" />
          <span class="sidebar__label">设置</span>
        </span>
      </m3e-button>
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
  border-right: 1px solid #242424;
  border-radius: 14px 0 0 14px;
  background: #050505;
  color: #f2f2f2;
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
  color: #f5f5f5;
  cursor: pointer;
}

/* --- 所有可交互元素的弹性交互反馈 --- */
.sidebar__logo,
.sidebar__toggle,
.sidebar__action,
.sidebar__expand,
.sidebar__settings {
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
  --m3e-icon-button-icon-color: #969696;
  --m3e-icon-button-hover-icon-color: #f0f0f0;
  width: 40px;
  height: 40px;

  m3e-icon { font-size: 24px; }
}

/* --- 主操作区：主页和新建对话 --- */
.sidebar__actions {
  display: grid;
  gap: 6px;
  flex: 0 0 auto;
  padding: 10px var(--sidebar-inset) 8px;
}

/* --- 操作按钮和设置按钮通用样式 --- */
.sidebar__action,
.sidebar__settings {
  --m3e-button-container-height: var(--sidebar-item-height);
  --m3e-text-button-label-text-color: #eeeeee;
  --m3e-button-leading-space: 15px;
  --m3e-button-trailing-space: 15px;
  display: block;
  width: 100%;
  min-width: 0;
  font-size: 16px;
  font-weight: 650;
  text-align: left;

  &.is-primary {
    --m3e-tonal-button-container-color: #1b1b1b;
    --m3e-tonal-button-label-text-color: #f1f1f1;
  }
}

/* --- 按钮内容行：图标 + 文字 --- */
.sidebar__action-content {
  display: flex;
  align-items: center;
  width: calc(var(--sidebar-width) - var(--sidebar-inset) * 2 - 30px); /* 适应侧边栏宽度变化 */
  min-width: 0;

  m3e-icon {
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
    font-size: 24px;
  }
}

/* --- 按钮文字标签 --- */
.sidebar__label {
  margin-left: 17px;
  white-space: nowrap;
}

/* --- 会话列表滚动区 --- */
.sidebar__conversations {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  padding: 16px 18px;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1 1 auto;
  scrollbar-width: thin;
  scrollbar-color: #242424 transparent;
}

/* --- 单个会话行：标题在左，关闭按钮在右 --- */
.sidebar__conversation-row {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 8px 0 15px;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 120ms ease;

  &:hover {
    background: #1a1a1a;
  }

  &:hover .sidebar__conversation-close {
    opacity: 1;
    pointer-events: auto;
  }

  &.is-active {
    background: #1e1e1e;
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
  color: #d8d8d8;
}

.sidebar__conversation-row.is-active .sidebar__conversation-title {
  color: #fff;
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
    --m3e-divider-color: #202020;
  }
}

.sidebar__settings {
  width: auto;
  flex: 0 0 var(--sidebar-item-height);
}

/* --- 收起态：所有按钮居中显示为纯图标 --- */
.sidebar.is-collapsed {
  .sidebar__header {
    justify-content: center;
    padding-inline: 16px;
  }

  .sidebar__action,
  .sidebar__settings {
    --m3e-button-leading-space: 0;
    --m3e-button-trailing-space: 0;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    justify-self: center;
  }

  .sidebar__action-content {
    justify-content: center;
    width: 24px;                                                      /* 收起态只显示图标 */
  }

  .sidebar__label { display: none; }                                  /* 收起态隐藏文字 */

  .sidebar__settings {
    margin-right: auto;
    margin-left: auto;
  }
}

/* --- 无障碍：关闭动画的降级 --- */
@media (prefers-reduced-motion: reduce) {
  .sidebar { transition-duration: 1ms; }
}
</style>
