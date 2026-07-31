<!--
聊天 Agent 选择器：只选择本次会话使用的 Agent 定义，不直接修改全局配置。
运行中锁定选择，避免同一根 Run 中途改变模型上下文。
调用示例：<AgentSelector :agents="store.agents.items" :value="chat.agentID" @select="selectAgent" />。
-->
<script setup>
import { computed, ref } from 'vue'                         // 引入选择列表派生和下拉引用

const props = defineProps({
  agents: { type: Array, default: () => [] },                // Server 返回的 Agent 定义目录
  value: { type: String, default: '' },                      // 当前会话 Agent ID
  disabled: { type: Boolean, default: false },               // Run 运行时禁止切换模型上下文
})
const emit = defineEmits(['select'])                         // 将选择反馈给 Chat 视图
const dropdown = ref(null)                                  // 保存 MDUI 下拉元素
const current = computed(() => props.agents.find((agent) => agent.id === props.value) || props.agents[0]) // 找到当前 Agent 展示名称


// --- 选择一个 Agent ---
function selectAgent(agent) {
  emit('select', agent.id)                                   // 只反馈 Agent 身份，不直接修改 Store
  dropdown.value.open = false                                // 选择完成后关闭菜单
}
</script>

<template>
  <mdui-dropdown ref="dropdown" class="agent-selector" placement="top-start" trigger="click">
    <mdui-button slot="trigger" class="agent-selector__trigger" variant="text" :disabled="disabled || !agents.length">
      <span>{{ current?.name || '选择 Agent' }}</span>
      <mdui-icon-expand-more slot="end-icon"></mdui-icon-expand-more>
    </mdui-button>
    <mdui-menu class="agent-selector__menu">
      <mdui-menu-item v-for="agent in agents" :key="agent.id" @click="selectAgent(agent)">
        <mdui-icon-check v-if="agent.id === value" slot="icon"></mdui-icon-check>
        <span v-else slot="icon" class="model-selector__dot"></span>
        {{ agent.name }}
      </mdui-menu-item>
    </mdui-menu>
  </mdui-dropdown>
</template>
