<!--
Agent 配置编辑器：维护多个模型选择和提示词定义；权限、工具、MCP、LSP、Skills 与工作区仍由共享配置统一管理。
组件只编辑设置页草稿，最终保存由 Settings 指令完成。
调用示例：<AgentProfiles v-model="draft" />。
-->
<script setup>
import { computed } from 'vue'                              // 引入 Agent 和供应商目录派生能力

const props = defineProps({ modelValue: { type: Object, required: true } }) // 接收设置页完整草稿
const emit = defineEmits(['update:modelValue'])              // 将草稿修改反馈给设置页
const entries = computed(() => Object.entries(props.modelValue.agents || {})) // 按稳定 ID 展示全部 Agent
const providers = computed(() => Object.entries(props.modelValue.providers || {})) // 为每个 Agent 提供可选供应商


// --- 新增一个 Agent 定义 ---
function addAgent() {
  const id = `agent-${crypto.randomUUID().slice(0, 8)}`              // 用短 UUID 避免名称冲突
  const provider = providers.value[0]?.[0] || ''                    // 首个供应商作为可编辑初值
  const model = props.modelValue.providers?.[provider]?.models?.[0] || '' // 首个模型作为可编辑初值
  const agents = { ...(props.modelValue.agents || {}), [id]: { id, name: '新 Agent', provider, model, systemPrompt: props.modelValue.systemPrompt || '' } } // 新定义只复制模型选择字段
  emit('update:modelValue', { ...props.modelValue, agents, defaultAgentId: props.modelValue.defaultAgentId || id }) // 写回完整草稿
}


// --- 删除一个非默认 Agent ---
function removeAgent(id) {
  if (id === props.modelValue.defaultAgentId) return                    // 默认 Agent 必须先切换后才能删除
  const agents = { ...(props.modelValue.agents || {}) }                 // 复制集合避免删除影响原配置引用
  delete agents[id]                                                      // 删除目标模型选择
  emit('update:modelValue', { ...props.modelValue, agents })             // 写回剩余定义
}


// --- 切换供应商并回退到该供应商的首个模型 ---
function changeProvider(agent, event) {
  agent.provider = event.target.value                                      // 先切换 Agent 使用的供应商
  agent.model = props.modelValue.providers?.[agent.provider]?.models?.[0] || '' // 清除不属于新供应商的旧模型
}
</script>

<template>
  <section class="settings-section agent-profiles">
    <header class="settings-section__header">
      <div><h2>Agent 定义</h2><p>每个 Agent 只选择模型和提示词，共享权限、工具、MCP、LSP、Skills 与工作区。</p></div>
      <mdui-button-icon aria-label="新增 Agent" @click="addAgent"><mdui-icon-add></mdui-icon-add></mdui-button-icon>
    </header>
    <label class="provider-native-field"><span>默认 Agent</span><select :value="modelValue.defaultAgentId" @change="emit('update:modelValue', { ...modelValue, defaultAgentId: $event.target.value })"><option v-for="([id, agent]) in entries" :key="id" :value="id">{{ agent.name || id }}</option></select></label>
    <article v-for="([id, agent]) in entries" :key="id" class="agent-profile">
      <header><strong>{{ agent.name || id }}</strong><mdui-button-icon v-if="id !== modelValue.defaultAgentId" aria-label="删除 Agent" @click="removeAgent(id)"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon></header>
      <div class="provider-fields">
        <mdui-text-field label="名称" variant="outlined" :value="agent.name" @input="agent.name = $event.target.value"></mdui-text-field>
        <label class="provider-native-field"><span>供应商</span><select :value="agent.provider" @change="changeProvider(agent, $event)"><option v-for="([name]) in providers" :key="name" :value="name">{{ name }}</option></select></label>
        <label class="provider-native-field"><span>模型</span><select :value="agent.model" @change="agent.model = $event.target.value"><option v-for="model in modelValue.providers?.[agent.provider]?.models || []" :key="model" :value="model">{{ model }}</option></select></label>
        <mdui-text-field class="provider-fields__wide" label="系统提示词" variant="outlined" autosize :min-rows="3" :value="agent.systemPrompt" @input="agent.systemPrompt = $event.target.value"></mdui-text-field>
      </div>
    </article>
  </section>
</template>
