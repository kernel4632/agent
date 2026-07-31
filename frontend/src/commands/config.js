/*
配置指令：负责读取、保存、切换和测试 Agent 配置。
所有请求反馈写入 store.js，表单草稿操作由 commands/settings.js 负责。
调用示例：await Config.load()、await Config.selectModel('openai', 'gpt-4.1')。
*/
import { AgentAPI } from '../api.js'                    // 引入配置 HTTP 指令
import { useConfigStore } from '../store.js'            // 引入配置数据结构


// --- 读取当前配置 ---
async function load() {
  const configStore = useConfigStore()                  // 读取配置和请求反馈字段
  configStore.isLoading = true                          // 设置区域进入加载反馈
  configStore.errorMessage = ''                         // 新请求清除旧错误
  try {
    configStore.config = await AgentAPI.getConfig()     // 用 Server 脱敏配置替换当前数据
    return configStore.config                           // 返回配置供表单创建草稿
  } catch (error) {
    configStore.errorMessage = error.message            // 保存连接或解析错误
    return null                                         // 失败时不制造默认配置
  } finally {
    configStore.isLoading = false                       // 恢复设置交互
  }
}


// --- 保存配置修改 ---
async function save(changes) {
  const configStore = useConfigStore()                  // 读取配置和保存反馈字段
  configStore.isLoading = true                          // 保存按钮进入进行状态
  configStore.isSaved = false                           // 新保存清除旧成功反馈
  configStore.errorMessage = ''                         // 新保存清除旧错误
  try {
    await AgentAPI.updateConfig(changes)                // 将入口明确提交的字段写入 Server
    configStore.config = await AgentAPI.getConfig()     // 重新读取 Server 最终生效配置
    configStore.isSaved = true                          // 向设置页反馈保存完成
    return true                                         // 返回成功供表单重置草稿
  } catch (error) {
    configStore.errorMessage = error.message            // 保存失败时展示真实原因
    return false                                        // 表单继续保留用户输入
  } finally {
    configStore.isLoading = false                       // 恢复保存动作
  }
}


// --- 切换下一轮聊天模型 ---
async function selectModel(providerName, modelName) {
  const configStore = useConfigStore()                  // 读取当前运行配置
  if (!providerName || !modelName) return false         // 不完整选择不能覆盖可用模型
  configStore.errorMessage = ''                         // 新切换清除旧配置错误
  try {
    await AgentAPI.updateConfig({ activeProvider: providerName, activeModel: modelName }) // 将选择写入 Server
    configStore.config = { ...configStore.config, activeProvider: providerName, activeModel: modelName } // 原位反馈当前模型
    return true                                         // 返回 Server 已接受选择
  } catch (error) {
    configStore.errorMessage = error.message            // 保存真实切换失败原因
    return false                                        // 保持旧模型选择
  }
}


// --- 测试已保存模型连接 ---
async function testConnection(providerName, modelName) {
  try {
    return await AgentAPI.testProvider(providerName, modelName) // 使用 Server 已保存认证执行测试
  } catch (error) {
    return { ok: false, provider: providerName, model: modelName, error: error.message } // 返回结构化失败反馈
  }
}


export const Config = { load, save, selectModel, testConnection } // 暴露全部配置指令
