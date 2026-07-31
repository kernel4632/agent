<!--
顶部能力状态窗：以 OpenCode 式紧凑弹层反馈 MCP、LSP、Skills 运行状态。
弹层只提供检查、重载和跳转，完整增删改配置统一进入设置页。
调用示例：<CapabilityPopover @open-settings="ui.openSettings('capabilities')" />。
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


// --- 打开完整能力设置 ---
function openSettings() {
  dropdown.value.open = false                         // 先收起顶部浮层释放视线
  emit('open-settings')                               // 再切换到设置中的能力页面
}


// --- 从顶部立即重载能力 ---
async function reload() {
  try { await store.reload() } catch {}               // 错误已进入共享状态并在弹层原位显示
}

onMounted(() => store.load().catch(() => {}))         // 应用启动即提供真实状态计数
</script>

<template>
  <mdui-dropdown ref="dropdown" class="capability-popover" placement="bottom-end" trigger="click">
    <mdui-button-icon slot="trigger" aria-label="能力状态" @click="store.load().catch(() => {})">
      <mdui-icon-build></mdui-icon-build>
    </mdui-button-icon>
    <section class="capability-popover__panel" aria-label="运行能力">
      <header><div><strong>运行能力</strong><small>{{ snapshot.tools.length }} 个可用工具</small></div><span v-if="runtimeErrors" class="capability-popover__error">{{ runtimeErrors }}</span></header>
      <div class="capability-popover__list">
        <div><span class="service-status" :class="mcpConnected ? 'is-connected' : 'is-disconnected'"></span><strong>MCP</strong><small>{{ mcpConnected }} / {{ snapshot.mcp.length }} 已连接</small></div>
        <div><span class="service-status" :class="lspConnected ? 'is-connected' : 'is-disconnected'"></span><strong>LSP</strong><small>{{ lspConnected }} / {{ snapshot.lsp.length }} 已连接</small></div>
        <div><span class="service-status" :class="skillsEnabled ? 'is-connected' : 'is-disconnected'"></span><strong>Skills</strong><small>{{ skillsEnabled }} / {{ snapshot.skills.length }} 已启用</small></div>
      </div>
      <p v-if="errorMessage" class="capability-popover__message">{{ errorMessage }}</p>
      <footer><mdui-button variant="text" :loading="isLoading" @click="reload"><mdui-icon-refresh slot="icon"></mdui-icon-refresh>重载</mdui-button><mdui-button variant="filled" @click="openSettings">打开能力设置</mdui-button></footer>
    </section>
  </mdui-dropdown>
</template>
