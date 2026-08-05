/*
工作区指令集：加载、列出、添加和移除工作区记录。
工作区只保存 id、path 和 sessions 摘要；移除记录不会删除用户目录或会话文件。
调用示例：await Workspace.load('C:/Users/me/.agent/workspace.json')、await Workspace.add('C:/project')。
*/
import { mkdir } from 'node:fs/promises'                // 引入数据目录创建能力
import { dirname, resolve } from 'node:path'            // 引入稳定绝对路径和父目录定位能力
import { Mutex } from 'async-mutex'                     // 引入互斥锁保证工作区保存串行
import createError from 'http-errors'                   // 引入标准 HTTP 错误创建
import { nanoid } from 'nanoid'                         // 引入工作区唯一 ID 生成能力
import { store } from '../store.js'                     // 引入工作区 KV 数据
import { File } from '../utils/file.js'                 // 引入完整文件替换能力

let workspacePath = ''                                  // 保存 workspace.json 的实际位置
const mutex = new Mutex()                               // 工作区保存互斥：后一个快照等前一个完成


// --- 加载工作区 ---
async function load(filePath) {
  workspacePath = filePath                              // 后续保存写回同一个文件
  await mkdir(dirname(workspacePath), { recursive: true }) // 首次启动时创建数据目录
  const file = Bun.file(workspacePath)                  // 定位工作区文件
  const exists = await file.exists()                    // 记录是否需要创建工作区文件
  store.workspaces = exists ? await file.json() : {}    // 文件不存在时从空 KV 开始
  if (!exists) await save()                              // 首次运行创建当前格式的 workspace.json
  return list()                                         // 反馈恢复后的工作区
}


// --- 列出工作区 ---
function list() {
  return structuredClone(Object.values(store.workspaces)) // HTTP 列表保持数组，store 使用 KV
}


// --- 添加工作区 ---
async function add(path) {
  const normalizedPath = resolve(path)                  // 相对路径转换为稳定绝对路径
  if (Object.values(store.workspaces).some((item) => item.path.toLowerCase() === normalizedPath.toLowerCase())) throw createError(409, 'workspace path already exists') // 同一路径只保存一次

  const workspace = {                                   // 创建严格符合 store 的工作区结构
    id: `workspace-${nanoid(10)}`,                       // 生成稳定工作区身份
    path: normalizedPath,                                // 保存真实绝对路径
    sessions: [],                                        // 新工作区还没有会话摘要
  }
  store.workspaces[workspace.id] = workspace             // 按 ID 将记录加入全局 KV
  await save()                                           // 添加后立即保存
  return structuredClone(workspace)                      // 返回新工作区副本
}


// --- 移除工作区 ---
async function remove(id) {
  const workspace = store.workspaces[id]                // 按 ID 直接读取目标工作区
  if (!workspace) throw createError(404, 'workspace not found')
  if (workspace.sessions.length > 0) throw createError(409, 'workspace still contains sessions')
  delete store.workspaces[id]                           // 只移除工作区记录
  await save()                                          // 不删除目录或会话文件
  return { id }                                         // 返回被移除的工作区 ID
}


// --- 保存工作区 ---
function save() {
  if (!workspacePath) throw new Error('workspaces have not been loaded') // 未加载时没有合法写入位置
  return mutex.runExclusive(() => {                     // 互斥保证并发保存按顺序写入
    const snapshot = structuredClone(store.workspaces)  // 固定本次保存内容
    return File.write(workspacePath, `${JSON.stringify(snapshot, null, 2)}\n`)
  })
}


export const Workspace = { load, list, add, remove, save } // 导出工作区最小动作
