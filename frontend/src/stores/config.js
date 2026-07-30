/*
配置数据仓库：读取和保存当前提供商、模型、系统提示词及权限设置。
表单使用 draft 编辑副本，只有 save 成功后才替换当前配置，避免半成品即时污染运行状态。
调用示例：await config.load()、await config.save(changes)。
*/
import { ref } from 'vue'                           // 引入 Vue 响应式配置数据
import { defineStore } from 'pinia'                 // 引入 Pinia 数据仓库定义能力
import { AgentAPI } from '../api.js'                // 引入配置 HTTP 指令

export const useConfigStore = defineStore('config', () => { // 导出唯一配置仓库
  const config = ref(null)                          // Server 返回的脱敏完整配置
  const isLoading = ref(false)                      // 配置读取或保存状态
  const isSaved = ref(false)                        // 最近一次保存成功反馈
  const errorMessage = ref('')                      // 最近一次配置错误


  // --- 读取当前配置 ---
  async function load() {
    isLoading.value = true                          // 设置页进入加载状态
    errorMessage.value = ''                         // 清除旧错误
    try {
      config.value = await AgentAPI.getConfig()     // 从真实 Server 读取脱敏配置
      return config.value                           // 反馈配置供表单创建副本
    } catch (error) {
      errorMessage.value = error.message            // 保存连接或解析错误
      return null                                   // 失败时不制造默认配置
    } finally {
      isLoading.value = false                       // 结束加载反馈
    }
  }


  // --- 保存配置修改 ---
  async function save(changes) {
    isLoading.value = true                          // 保存按钮进入进行状态
    isSaved.value = false                           // 新保存开始时清除成功反馈
    errorMessage.value = ''                         // 清除旧错误
    try {
      await AgentAPI.updateConfig(changes)          // 将用户明确修改的字段写入 Server
      await load()                                  // 重新读取实际生效配置
      isSaved.value = true                          // 向设置页反馈保存完成
      return true                                   // 反馈指令成功
    } catch (error) {
      errorMessage.value = error.message            // 保存失败时展示原因
      return false                                  // 表单继续保留用户输入
    } finally {
      isLoading.value = false                       // 结束保存进行状态
    }
  }


  // --- 即时切换聊天模型 ---
  async function selectModel(providerName, modelName) {
    if (!providerName || !modelName) return false    // 不完整选择不能覆盖当前可用模型
    errorMessage.value = ''                          // 新切换清除旧配置错误
    try {
      await AgentAPI.updateConfig({ activeProvider: providerName, activeModel: modelName }) // 下一轮模型调用立即使用新选择
      config.value = { ...config.value, activeProvider: providerName, activeModel: modelName } // 就地反馈输入器当前模型
      return true                                    // 反馈切换已由 Server 接受
    } catch (error) {
      errorMessage.value = error.message             // 在对话区展示真实切换失败原因
      return false                                   // 保持旧模型选择
    }
  }


  return { config, isLoading, isSaved, errorMessage, load, save, selectModel } // 暴露配置数据与读写动作
})
