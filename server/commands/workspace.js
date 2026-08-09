/*
工作区指令集：列出、添加和移除工作区。
工作区只记录 id、path 和 sessions 摘要，移除记录不删除用户目录。
调用示例：Workspace.list()、Workspace.add('/path/to/project')、Workspace.remove('workspace-xxx')。
*/
import { resolve } from 'node:path'                      // 引入绝对路径解析能力
import { nanoid } from 'nanoid'                          // 引入唯一 ID 生成能力
import { store } from '../store.js'                      // 引入工作区数据
import { File } from '../utils/file.js'                  // 引入原子写文件能力

let filepath = ''                                        // 工作区文件路径，启动时设定


// --- 列出全部工作区 ---
function list() {
  return Object.entries(store.workspaces).map(([id, ws]) => ({ id, ...ws }))
}


// --- 添加工作区 ---
async function add(path) {
  const id = `workspace-${nanoid(10)}`
  store.workspaces[id] = { path: resolve(path), sessions: [] }
  await File.write(filepath, JSON.stringify(store.workspaces, null, 2) + '\n')
  return { id, ...store.workspaces[id] }
}


// --- 移除工作区 ---
async function remove(id) {
  delete store.workspaces[id]
  await File.write(filepath, JSON.stringify(store.workspaces, null, 2) + '\n')
  return { id }
}


// --- 设定文件路径并加载（server.js 启动时调用）---
async function load(filePath) {
  filepath = filePath
  const file = Bun.file(filepath)
  if (await file.exists()) store.workspaces = await file.json()
  else await File.write(filepath, JSON.stringify(store.workspaces, null, 2) + '\n')
}


export const Workspace = { list, add, remove, load }
