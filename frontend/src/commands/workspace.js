/*
工作区指令：负责选择、添加和移除工作区，并维护其 Session 摘要列表。
未来 API 只替换标记位置，页面与 Store 数据形状保持不变。
调用示例：Workspace.select('workspace-agent')、Workspace.add(name, path)。
*/
import { store } from '../store.js'                                  // 引入工作区目录和当前选择
import { UI } from './ui.js'                                         // 引入完成动作后的轻反馈
import { t } from '../i18n.js'                                       // 引入当前语言反馈文案


// --- 选择工作区 ---
function select(workspaceID) {
  if (!store.workspaces.some((workspace) => workspace.id === workspaceID)) return // 不存在的身份不能成为当前工作区
  store.ui.activeWorkspaceID = workspaceID                            // 首页 Session 列表自动跟随响应
}


// --- 添加工作区 ---
function add(name, path) {
  const cleanName = name.trim()                                       // 名称不保存首尾空白
  const cleanPath = path.trim()                                       // 路径不保存首尾空白
  if (!cleanName || !cleanPath) return false                          // 两个字段缺一不可

  // TODO(API): POST /workspace，成功后使用 Server 返回的 Workspace 替换本地对象。
  const workspace = { id: `workspace-${crypto.randomUUID().slice(0, 8)}`, name: cleanName, path: cleanPath, sessions: [], createdAt: Date.now(), updatedAt: Date.now() }
  store.workspaces.push(workspace)                                    // 新工作区进入主页左侧列表
  store.ui.activeWorkspaceID = workspace.id                           // 创建后立即打开新工作区
  UI.notify(t('workspaceAdded'))                                      // 反馈添加完成
  return true                                                         // 通知弹窗可以关闭
}


// --- 移除工作区 ---
function remove(workspaceID) {
  const index = store.workspaces.findIndex((workspace) => workspace.id === workspaceID) // 查找目标位置
  if (index < 0) return false                                         // 已不存在时保持页面不变

  // TODO(API): DELETE /workspace，请求体携带 workspaceId；不会删除本地目录。
  store.workspaces.splice(index, 1)                                   // 从目录中移除工作区
  store.ui.activeWorkspaceID = store.workspaces[0]?.id || ''          // 选择剩余首项或空状态
  UI.notify(t('workspaceRemoved'))                                    // 明确不表示删除本地目录
  return true                                                         // 反馈动作完成
}


export const Workspace = { select, add, remove }                       // 暴露工作区目录动作
