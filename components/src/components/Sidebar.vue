<!--
通用应用侧边栏：提供产品入口、主操作、会话切换和设置入口，不包含页面跳转逻辑。
调用方通过 v-model:collapsed 控制展开状态，并通过事件处理每个导航动作。
调用示例：<Sidebar :conversations="conversations" @select-conversation="openConversation" />。
-->
<script setup>
const collapsed = defineModel('collapsed', { type: Boolean, default: false }) // 保存展开与收起状态
const props = defineProps({                                                   // 接收会话列表和当前选中项
  conversations: {
    type: Array,
    default: () => [
      { id: 'conversation-1', title: '欢迎使用 Agent' },
      { id: 'conversation-2', title: '设计一个新的工作流' },
      { id: 'conversation-3', title: '整理项目开发计划' },
    ],
  },
  activeConversationId: { type: [String, Number], default: null },
})
const emit = defineEmits(['home', 'new-conversation', 'select-conversation', 'settings']) // 输出用户导航意图


// --- 切换侧边栏显示状态 ---
function toggleSidebar() {
  collapsed.value = !collapsed.value                                          // 同步 v-model 给调用方
}
</script>

<template>
  <aside class="sidebar" :class="{ 'is-collapsed': collapsed }" aria-label="侧边栏">
    <!-- 第一排：产品标识和展开态收起按钮。 -->
    <header class="sidebar__header">
      <button class="sidebar__logo" type="button" aria-label="产品首页" @click="emit('home')">
        <slot name="logo"><span class="sidebar__logo-mark">A</span></slot>
      </button>

      <m3e-icon-button v-if="!collapsed" class="sidebar__toggle" type="button" shape="rounded" aria-label="收起侧边栏" title="收起侧边栏" @click="toggleSidebar">
        <m3e-icon name="keyboard_double_arrow_left" filled="1"></m3e-icon>
      </m3e-icon-button>
    </header>

    <!-- 第二排：主页和新建对话按钮组。 -->
    <nav class="sidebar__actions" aria-label="主要操作">
      <m3e-button class="sidebar__action" type="button" shape="rounded" aria-label="主页" :title="collapsed ? '主页' : undefined" @click="emit('home')">
        <span class="sidebar__action-content">
          <m3e-icon name="home" filled="1"></m3e-icon>
          <span class="sidebar__label">主页</span>
        </span>
      </m3e-button>

      <m3e-button class="sidebar__action is-primary" type="button" variant="tonal" shape="rounded" aria-label="新建对话" :title="collapsed ? '新建对话' : undefined" @click="emit('new-conversation')">
        <span class="sidebar__action-content">
          <m3e-icon name="edit_square" filled="1"></m3e-icon>
          <span class="sidebar__label">新建对话</span>
        </span>
      </m3e-button>
    </nav>

    <!-- 第三排：仅在展开时显示，并占满剩余高度。 -->
    <section v-if="!collapsed" class="sidebar__conversations" aria-label="会话列表">
      <button
        v-for="conversation in props.conversations"
        :key="conversation.id"
        class="sidebar__conversation"
        :class="{ 'is-active': conversation.id === props.activeConversationId }"
        type="button"
        @click="emit('select-conversation', conversation.id)"
      >
        {{ conversation.title }}
      </button>
    </section>

    <!-- 第四排：仅在收起时显示。 -->
    <m3e-icon-button v-if="collapsed" class="sidebar__expand" type="button" shape="rounded" aria-label="展开侧边栏" title="展开侧边栏" @click="toggleSidebar">
      <m3e-icon name="keyboard_double_arrow_right" filled="1"></m3e-icon>
    </m3e-icon-button>

    <!-- 第五排：始终固定在侧边栏底部。 -->
    <m3e-button class="sidebar__settings" type="button" shape="rounded" aria-label="设置" :title="collapsed ? '设置' : undefined" @click="emit('settings')">
      <span class="sidebar__action-content">
        <m3e-icon name="settings" filled="1"></m3e-icon>
        <span class="sidebar__label">设置</span>
      </span>
    </m3e-button>
  </aside>
</template>

<style scoped lang="scss">
.sidebar {
  --sidebar-width: 336px;
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
    --sidebar-width: 76px;
    --sidebar-inset: 9px;
  }
}

.sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 76px;
  padding: 10px 19px;
}

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

.sidebar__logo-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 3px solid currentcolor;
  border-radius: 12px 50% 50%;
  font-size: 16px;
  font-weight: 800;
  transform: rotate(-8deg);
}

.sidebar__toggle,
.sidebar__expand {
  --m3e-icon-button-icon-color: #969696;
  --m3e-icon-button-hover-icon-color: #f0f0f0;
  --m3e-icon-button-shape-pressed-morph: var(--md-sys-shape-corner-full);
  width: 40px;
  height: 40px;

  m3e-icon { font-size: 28px; }
}

.sidebar__actions {
  display: grid;
  gap: 6px;
  flex: 0 0 auto;
  padding: 10px var(--sidebar-inset) 8px;
}

.sidebar__action,
.sidebar__settings {
  --m3e-button-container-height: var(--sidebar-item-height);
  --m3e-button-shape-round: 16px;
  --m3e-button-shape-pressed-morph: 16px;
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

.sidebar__action-content {
  display: flex;
  align-items: center;
  width: calc(var(--sidebar-width) - var(--sidebar-inset) * 2 - 30px);
  min-width: 0;

  m3e-icon {
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
    font-size: 24px;
  }
}

.sidebar__label {
  margin-left: 17px;
  white-space: nowrap;
}

.sidebar__conversations {
  min-height: 0;
  padding: 16px 18px;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1 1 auto;
  scrollbar-width: thin;
  scrollbar-color: #242424 transparent;
}

.sidebar__conversation {
  display: block;
  width: 100%;
  padding: 11px 12px;
  overflow: hidden;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #d8d8d8;
  font: inherit;
  font-size: 15px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;

  &:hover,
  &.is-active {
    background: #171717;
    color: #ffffff;
  }
}

.sidebar__expand {
  flex: 0 0 40px;
  margin: auto auto 16px;
}

.sidebar__settings {
  width: auto;
  flex: 0 0 var(--sidebar-item-height);
  margin: 0 var(--sidebar-inset) 12px;
  border-top: 1px solid #202020;
}

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
  }

  .sidebar__action-content {
    justify-content: center;
    width: 24px;
  }

  .sidebar__label { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar { transition-duration: 1ms; }
}
</style>
