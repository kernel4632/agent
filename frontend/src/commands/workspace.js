/*
工作区指令：负责从 Server 加载、选择、添加和移除工作区定义。
所有网络结果写入 store.workspaces，主页和侧边栏由 Vue 自动反馈。
调用示例：await Workspace.load()、await Workspace.add(name, path)。
*/
import { AgentAPI } from '../api.js'                    // 引入正式工作区 HTTP 契约
import { store } from '../store.js'                     // 引入工作区目录和当前选择
import { UI } from './ui.js'                            // 引入成功与错误轻反馈
import { t } from '../i18n.js'                          // 引入当前语言反馈文案


// --- 加载工作区目录 ---
async function load() {
  try {
    const workspaces = await AgentAPI.listWorkspaces()  // 从 Server 读取完整主页数据
    store.workspaces.splice(0, store.workspaces.length, ...workspaces) // 保留响应式数组身份并替换内容
    if (!workspaces.some((workspace) => workspace.id === store.ui.activeWorkspaceID)) store.ui.activeWorkspaceID = workspaces[0]?.id || '' // 保持有效当前选择
    return true                                         // 反馈应用启动可以继续
  } catch (error) {
    store.ui.errorMessage = error.message               // 将真实连接错误交给页面展示
    return false                                        // 不制造演示工作区掩盖故障
  }
}


// --- 选择工作区 ---
function select(workspaceID) {
  if (!store.workspaces.some((workspace) => workspace.id === workspaceID)) return false // 不存在的身份不能成为当前工作区
  store.ui.activeWorkspaceID = workspaceID              // 首页会话列表自动跟随响应
  return true                                           // 反馈选择已经生效
}


// --- 添加工作区 ---
async function add(name, path) {
  const cleanName = name.trim()                         // 名称不保存首尾空白
  const cleanPath = path.trim()                         // 路径不保存首尾空白
  if (!cleanName || !cleanPath) return false            // 两个字段缺一不可

  try {
    const result = await AgentAPI.createWorkspace(cleanPath) // 让 Server 验证路径重复并持久化
    store.workspaces.push({ ...result, sessions: result.sessions || [] }) // 新工作区进入主页目录
    store.ui.activeWorkspaceID = result.id ?? result.workspace?.id ?? '' // 创建后立即选中新工作区
    UI.notify(t('workspaceAdded'))                                        // 反馈添加完成
    return true                                                           // 通知弹窗关闭
  } catch (error) {
    UI.notify(error.message)                                              // 原位反馈 Server 验证错误
    return false                                                          // 保留弹窗草稿供用户修正
  }
}


// --- 移除工作区 ---
async function remove(workspaceID) {
  const index = store.workspaces.findIndex((workspace) => workspace.id === workspaceID) // 查找目标位置
  if (index < 0) return false                                            // 已不存在时保持页面不变
  try {
    await AgentAPI.removeWorkspace(workspaceID)                          // Server 确保没有孤立会话
    store.workspaces.splice(index, 1)                                    // 成功后从目录移除定义
    store.ui.activeWorkspaceID = store.workspaces[0]?.id || ''           // 选择剩余首项或空状态
    UI.notify(t('workspaceRemoved'))                                     // 明确不删除本地目录
    return true                                                          // 反馈动作完成
  } catch (error) {
    UI.notify(error.message)                                             // 会话冲突等错误直接展示
    return false                                                         // 保持当前目录不变
  }
}


export const Workspace = { load, select, add, remove }                  // 暴露工作区全部业务动作
