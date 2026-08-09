/*
会话指令集：获取、创建、修改和删除会话。
会话数据存在 store.sessions[id]，持久化为独立 JSON 文件。
调用示例：Session.get('session-xxx')、Session.create('workspace-xxx', 'openai', 'gpt-4')。
*/
import { join } from 'node:path'                         // 引入文件路径拼接能力
import { rm } from 'node:fs/promises'                    // 引入文件删除能力
import { nanoid } from 'nanoid'                          // 引入唯一 ID 生成能力
import { store } from '../store.js'                      // 引入会话和工作区数据
import { File } from '../utils/file.js'                  // 引入原子写文件能力
import { Workspace } from './workspace.js'               // 引入工作区保存能力

let directory = ''                                       // 会话文件目录，启动时设定


// --- 获取会话 ---
async function get(id) {
  if (store.sessions[id]) return { id, ...store.sessions[id] }
  const file = Bun.file(join(directory, `${id}.json`))
  if (!await file.exists()) return null
  store.sessions[id] = await file.json()                 // 从磁盘加载到内存
  return { id, ...store.sessions[id] }
}


// --- 创建会话 ---
async function create(workspaceId, provider, model) {
  const id = `session-${nanoid(10)}`
  store.sessions[id] = { messages: [], provider, model }
  store.workspaces[workspaceId].sessions.push({ id, title: '新对话', lastActiveAt: Date.now() })
  await save(id)
  await Workspace.save()                                 // 通过 Workspace 集中保存，不自己拼路径
  return { id, ...store.sessions[id] }
}


// --- 修改会话 ---
async function update(id, { title, provider, model } = {}) {
  if (!store.sessions[id]) await get(id)
  const session = store.sessions[id]
  if (provider !== undefined) session.provider = provider
  if (model !== undefined) session.model = model

  if (title !== undefined) {
    for (const workspace of Object.values(store.workspaces)) {
      const found = workspace.sessions.find((s) => s.id === id)
      if (found) { found.title = title; found.lastActiveAt = Date.now(); break }
    }
    await Workspace.save()
  }
  await save(id)
  return { id, ...session }
}


// --- 删除会话 ---
async function remove(id) {
  await rm(join(directory, `${id}.json`), { force: true })
  delete store.sessions[id]
  delete store.runtime[id]
  for (const workspace of Object.values(store.workspaces)) {
    workspace.sessions = workspace.sessions.filter((s) => s.id !== id)
  }
  await Workspace.save()
  return { id }
}


// --- 保存单个会话到磁盘 ---
async function save(id) {
  await File.write(join(directory, `${id}.json`), JSON.stringify(store.sessions[id], null, 2) + '\n')
}


// --- 设定目录（server.js 启动时调用）---
function init(dir) {
  directory = dir
}


export const Session = { get, create, update, remove, save, init }
