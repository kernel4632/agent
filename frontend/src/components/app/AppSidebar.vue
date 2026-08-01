<!--
应用侧边栏：严格组合结构文档规定的五段内容，不执行业务修改。
每个子组件发出的意图继续透传给 App，由 App 调用 Session 或 UI Command。
调用示例：<AppSidebar :open="store.ui.sidebarOpen" :sessions="recentSessions" @home="openHome" />。
-->
<script setup>
import RecentSessions from './RecentSessions.vue'                    // 引入第三段最近会话目录
import SidebarDestinations from './SidebarDestinations.vue'          // 引入第二段主目的地
import SidebarFooter from './SidebarFooter.vue'                      // 引入第四、第五段底部动作
import SidebarHeader from './SidebarHeader.vue'                      // 引入第一段产品入口

defineProps({
  open: { type: Boolean, default: false },                            // 当前侧边栏展开状态
  view: { type: String, default: 'home' },                            // 当前应用页面
  activeSessionId: { type: String, default: '' },                     // 当前 Session 身份
  sessions: { type: Array, default: () => [] },                       // 最近 Session 摘要
})
defineEmits(['home', 'create', 'open-session', 'collapse', 'expand', 'settings']) // 向 App 反馈全部侧栏意图
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--open': open }">
    <SidebarHeader :open="open" @home="$emit('home')" @collapse="$emit('collapse')" />
    <SidebarDestinations :open="open" :view="view" @home="$emit('home')" @create="$emit('create')" />
    <RecentSessions v-if="open" :sessions="sessions" :active-id="activeSessionId" :view="view" @open="$emit('open-session', $event)" />
    <SidebarFooter :open="open" :view="view" @expand="$emit('expand')" @settings="$emit('settings')" />
  </aside>
</template>
