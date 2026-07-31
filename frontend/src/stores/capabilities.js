/*
能力数据：定义 MCP、LSP、Skills 和工具的当前运行快照。
本文件只保存运行数据，读取与重载统一由 commands/capability.js 执行。
调用示例：const capabilityStore = useCapabilityStore()。
*/
import { ref } from 'vue'                                  // 引入能力字段需要的响应式容器
import { defineStore } from 'pinia'                        // 引入能力数据仓库定义能力

export const useCapabilityStore = defineStore('capabilities', () => { // 暴露唯一能力数据结构
  const snapshot = ref({ tools: [], mcp: [], lsp: [], skills: [], skillErrors: [] }) // Server 当前能力目录
  const draft = ref(null)                                   // MCP、LSP 与 Skills 的未保存编辑副本
  const isLoading = ref(false)                             // 能力是否正在读取或重建
  const isSaving = ref(false)                              // 能力声明是否正在保存和应用
  const feedback = ref('')                                 // 最近一次成功动作的页面反馈
  const errorMessage = ref('')                             // 最近一次能力请求的错误说明

  return { snapshot, draft, isLoading, isSaving, feedback, errorMessage } // 只暴露能力数据，不附带修改动作
})
