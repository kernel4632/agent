/*
工作区指令集：加载、列出、添加和移除工作区记录。
工作区只保存 id、path 和 sessions 摘要；移除记录不会删除用户目录或会话文件。
调用示例：await Workspace.load('C:/Users/me/.agent/workspace.json')、await Workspace.add('C:/project')。
*/
import { mkdir } from 'node:fs/promises'                // 引入数据目录创建能力
import { dirname, resolve } from 'node:path'            // 引入稳定绝对路径和父目录定位能力
import { nanoid } from 'nanoid'                         // 引入工作区唯一 ID 生成能力
import { store } from '../store.js'                     // 引入工作区数据列表
import { writeJSON } from '../utils/json.js'            // 引入完整 JSON 文件替换能力

let workspacePath = ''                                  // 保存 workspace.json 的实际位置
let lastWorkspaceSave = Promise.resolve()               // 后一个工作区快照等待前一个保存完成


// --- 加载工作区 ---
async function load(filePath) {
  workspacePath = filePath                              // 后续保存写回同一个文件
  lastWorkspaceSave = Promise.resolve()                // 新应用实例不等待旧工作区文件写入
  await mkdir(dirname(workspacePath), { recursive: true }) // 首次启动时创建数据目录
  const file = Bun.file(workspacePath)                  // 定位工作区文件
  const saved = await file.exists() ? await file.json() : [] // 文件不存在时从空列表开始
  store.workspaces = Array.isArray(saved) ? saved : []  // 工作区根数据严格保持列表
  if (!await file.exists()) await save()                // 首次运行创建 workspace.json
  return list()                                         // 反馈恢复后的工作区
}


// --- 列出工作区 ---
function list() {
  return structuredClone(store.workspaces)              // 返回副本避免入口直接修改 store
}


// --- 添加工作区 ---
async function add(path) {
  const normalizedPath = resolve(path)                  // 相对路径转换为稳定绝对路径
  if (store.workspaces.some((item) => item.path.toLowerCase() === normalizedPath.toLowerCase())) throw businessError(409, 'workspace path already exists') // 同一路径只保存一次

  const workspace = {                                   // 创建严格符合 store 的工作区结构
    id: `workspace-${nanoid(10)}`,                       // 生成稳定工作区身份
    path: normalizedPath,                                // 保存真实绝对路径
    sessions: [],                                        // 新工作区还没有会话摘要
  }
  store.workspaces.push(workspace)                       // 将记录加入全局列表
  await save()                                           // 添加后立即保存
  return structuredClone(workspace)                      // 返回新工作区副本
}


// --- 移除工作区 ---
async function remove(id) {
  const index = store.workspaces.findIndex((item) => item.id === id) // 查找目标工作区
  if (index < 0) throw businessError(404, 'workspace not found') // 不存在时返回资源错误
  if (store.workspaces[index].sessions.length > 0) throw businessError(409, 'workspace still contains sessions') // 保留会话时不能制造失去归属的数据
  store.workspaces.splice(index, 1)                     // 只移除工作区记录
  await save()                                          // 不删除目录或会话文件
  return { id }                                         // 返回被移除的工作区 ID
}


// --- 保存工作区 ---
function save() {
  if (!workspacePath) throw new Error('workspaces have not been loaded') // 未加载时没有合法写入位置
  const snapshot = structuredClone(store.workspaces)    // 固定本次保存内容，避免序列化期间继续变化
  const currentSave = lastWorkspaceSave.then(() => writeJSON(workspacePath, snapshot)) // 按业务顺序保存当前快照
  lastWorkspaceSave = currentSave.catch(() => {})       // 单次失败不能阻塞后续保存
  return currentSave                                    // 调用方等待当前快照真正落盘
}


// --- 读取可修改工作区 ---
function getMutable(id) {
  return store.workspaces.find((workspace) => workspace.id === id) ?? null // 只供 commands 内部修改摘要
}


// --- 创建业务错误 ---
function businessError(status, message) {
  return Object.assign(new Error(message), { status })  // 让 server.js 统一转换 HTTP 状态
}


export const Workspace = { load, list, add, remove, save, getMutable } // 导出工作区最小动作
