/*
能力运行态仓库：让顶部状态窗与设置页共享同一份 MCP、LSP、Skills 快照。
配置草稿仍由设置组件管理；本仓库只负责读取和重载真实运行状态。
调用示例：const capabilities = useCapabilityStore(); await capabilities.load()。
*/
import { ref } from 'vue'                              // 引入运行快照和请求状态
import { defineStore } from 'pinia'                    // 引入全局状态仓库定义
import { AgentAPI } from '../api.js'                   // 引入能力查询与重载指令

export const useCapabilityStore = defineStore('capabilities', () => {
  const snapshot = ref({ tools: [], mcp: [], lsp: [], skills: [], skillErrors: [] }) // 当前 Server 能力目录
  const isLoading = ref(false)                         // 顶部窗和设置页共享忙碌反馈
  const errorMessage = ref('')                         // 最近一次读取或重载错误


  // --- 读取当前能力运行态 ---
  async function load() {
    isLoading.value = true                             // 防止重复状态动作
    errorMessage.value = ''                           // 新请求清理旧错误
    try {
      snapshot.value = await AgentAPI.listCapabilities() // 使用 Server 最终运行快照替换旧值
      return snapshot.value                           // 让调用方可继续组合配置读取
    } catch (error) {
      errorMessage.value = error.message              // 顶部和设置页显示同一错误
      throw error                                     // 设置页保留自己的保存失败流程
    } finally {
      isLoading.value = false                         // 恢复交互
    }
  }


  // --- 按当前配置重建外部能力 ---
  async function reload() {
    isLoading.value = true                             // 重连期间锁定重复请求
    errorMessage.value = ''                           // 清理旧连接错误
    try {
      await AgentAPI.reloadCapabilities()             // 关闭旧连接并重新发现能力
      snapshot.value = await AgentAPI.listCapabilities() // 获取重建后的真实状态
      return snapshot.value                           // 向设置页反馈完成
    } catch (error) {
      errorMessage.value = error.message              // 保留可见错误供排查
      throw error                                     // 保存动作需要知道重连失败
    } finally {
      isLoading.value = false                         // 恢复交互
    }
  }

  return { snapshot, isLoading, errorMessage, load, reload } // 暴露统一运行态指令
})
