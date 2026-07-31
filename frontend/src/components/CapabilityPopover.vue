<!--
顶部服务状态窗：以 OpenCode 式紧凑弹层反馈 MCP、LSP、Skills 运行状态。
弹层只提供检查、重载和跳转，完整增删改配置统一进入设置页。
调用示例：<CapabilityPopover @open-settings="ui.openSettings($event)" />。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'         // 引入状态统计和弹层引用
import { storeToRefs } from 'pinia'                    // 保持 Pinia 字段响应性
import { useCapabilityStore } from '../stores/capabilities.js' // 引入共享运行态

const emit = defineEmits(['open-settings'])            // 将完整管理入口交给应用壳层
const dropdown = ref(null)                             // 保存 MDUI 弹层以便跳转前关闭
const store = useCapabilityStore()                     // 读取共享能力状态
const { snapshot, isLoading, errorMessage } = storeToRefs(store) // 解构响应式快照
const mcpConnected = computed(() => snapshot.value.mcp.filter((item) => item.status === 'connected').length) // MCP 成功连接数
const lspConnected = computed(() => snapshot.value.lsp.filter((item) => item.status === 'connected').length) // LSP 成功连接数
const skillsEnabled = computed(() => snapshot.value.skills.filter((item) => item.enabled).length) // 当前启用 Skill 数
const runtimeErrors = computed(() => [...snapshot.value.mcp, ...snapshot.value.lsp].filter((item) => item.error).length + snapshot.value.skillErrors.length) // 汇总可排查错误
const capabilityGroups = computed(() => [                 // 将运行快照整理为弹窗可直接扫描的具体条目
  {
    id: 'mcp', label: 'MCP', summary: `${mcpConnected.value} / ${snapshot.value.mcp.length} 已连接`,
    items: snapshot.value.mcp.map((item) => ({ name: item.name, detail: `${item.toolCount || 0} 个工具`, status: item.status })),
  },
  {
    id: 'lsp', label: 'LSP', summary: `${lspConnected.value} / ${snapshot.value.lsp.length} 已连接`,
    items: snapshot.value.lsp.map((item) => ({ name: item.name, detail: item.status, status: item.status })),
  },
  {
    id: 'skills', label: '技能', summary: `${skillsEnabled.value} / ${snapshot.value.skills.length} 已启用`,
    items: snapshot.value.skills.map((item) => ({ name: item.name, detail: item.enabled ? '已启用' : '已停用', status: item.enabled ? 'connected' : 'disconnected' })),
  },
])


// --- 打开完整能力设置 ---
function openSettings(section) {
  dropdown.value.open = false                         // 先收起顶部浮层释放视线
  emit('open-settings', section)                      // 再切换到对应 MCP、LSP 或技能页面
}


// --- 从顶部立即重载能力 ---
async function reload() {
  try { await store.reload() } catch {}               // 错误已进入共享状态并在弹层原位显示
}

onMounted(() => store.load().catch(() => {}))         // 应用启动即提供真实状态计数
</script>

<template>
  <mdui-dropdown ref="dropdown" class="capability-popover" placement="bottom-end" trigger="click">
    <mdui-button-icon slot="trigger" aria-label="服务状态" :disabled="isLoading">
      <mdui-icon-build></mdui-icon-build>
    </mdui-button-icon>
    <section class="capability-popover__panel" aria-label="运行状态">
      <header><div><strong>运行状态</strong><small>{{ snapshot.tools.length }} 个可用工具</small></div><span v-if="runtimeErrors" class="capability-popover__error">{{ runtimeErrors }}</span></header>
      <div class="capability-popover__list">
        <section v-for="group in capabilityGroups" :key="group.id" class="capability-popover__group">
          <button type="button" class="capability-popover__summary" @click="openSettings(group.id)"><strong>{{ group.label }}</strong><small>{{ group.summary }}</small><mdui-icon-chevron-right></mdui-icon-chevron-right></button>
          <div v-if="group.items.length" class="capability-popover__items">
            <div v-for="item in group.items" :key="item.name" class="capability-popover__item">
              <span class="service-status" :class="`is-${item.status}`"></span><strong>{{ item.name }}</strong><small>{{ item.detail }}</small>
            </div>
          </div>
          <div v-else class="capability-popover__empty">未配置</div>
        </section>
      </div>
      <p v-if="errorMessage" class="capability-popover__message">{{ errorMessage }}</p>
      <footer><mdui-button variant="text" :loading="isLoading" @click="reload"><mdui-icon-refresh slot="icon"></mdui-icon-refresh>重载</mdui-button><mdui-button variant="filled" @click="openSettings('mcp')">管理 MCP</mdui-button></footer>
    </section>
  </mdui-dropdown>
</template>
