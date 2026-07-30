<!--
工具业务视图：读取 Server 工具注册表，并提供热重载指令和参数检查。
重载结果只作为短期反馈，列表始终以随后读取的真实注册表为准。
调用示例：App 在 activeView === 'tools' 时渲染 <Tools />。
-->
<script setup>
import { onMounted, ref } from 'vue'                  // 引入工具数据与首次加载能力
import { AgentAPI } from '../api.js'                 // 引入工具列表和重载指令

const tools = ref([])                                 // Server 当前注册的完整工具列表
const isLoading = ref(false)                          // 读取或重载进行状态
const feedback = ref('')                              // 最近一次工具动作反馈
const errorMessage = ref('')                          // 最近一次工具请求错误


// --- 读取工具注册表 ---
async function loadTools() {
  isLoading.value = true                              // 工具区域进入加载反馈
  errorMessage.value = ''                            // 新请求清除旧错误
  try {
    tools.value = await AgentAPI.listTools()          // 用 Server 真实注册表替换列表
  } catch (error) {
    errorMessage.value = error.message                // 向用户反馈读取失败原因
  } finally {
    isLoading.value = false                           // 恢复重载按钮状态
  }
}


// --- 热重载全部工具 ---
async function reloadTools() {
  isLoading.value = true                              // 锁定重复重载触发
  feedback.value = ''                                // 清除上次成功反馈
  errorMessage.value = ''                            // 清除上次失败反馈
  try {
    const result = await AgentAPI.reloadTools()       // 触发 Server 重新扫描工具目录
    feedback.value = `已加载 ${result.loaded ?? 0} 个工具` // 立即显示扫描结果
    await loadTools()                                 // 再读取真实注册表更新详情
  } catch (error) {
    errorMessage.value = error.message                // 保留旧列表并展示错误
    isLoading.value = false                           // 异常路径恢复按钮状态
  }
}

onMounted(loadTools)                                  // 首次进入读取工具数据
</script>

<template>
  <section class="workspace-view">
    <header class="view-header">
      <div>
        <h1>工具</h1>
        <p>{{ tools.length }} 个可供 Agent 调用的能力</p>
      </div>
      <mdui-button variant="tonal" :loading="isLoading" @click="reloadTools">
        <mdui-icon-refresh slot="icon"></mdui-icon-refresh>
        重载
      </mdui-button>
    </header>
    <div v-if="feedback" class="notice notice--success">{{ feedback }}</div>
    <div v-if="errorMessage" class="notice notice--error">{{ errorMessage }}</div>
    <div v-if="isLoading && !tools.length" class="view-loading">正在读取工具…</div>
    <div v-else class="tool-grid">
      <article v-for="tool in tools" :key="tool.name" class="tool-item">
        <header>
          <span class="tool-item__icon">›_</span>
          <div><h2>{{ tool.name }}</h2><small>{{ tool.source }}</small></div>
        </header>
        <p>{{ tool.description }}</p>
        <div v-if="Object.keys(tool.parameters || {}).length" class="tool-parameters">
          <div v-for="(parameter, name) in tool.parameters" :key="name">
            <code>{{ name }}</code>
            <span>{{ parameter.type }}{{ parameter.required ? ' · 必填' : '' }}</span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
