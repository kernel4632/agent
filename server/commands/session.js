/*
会话指令集：获取、创建、修改、删除会话，建立 SSE 连接，保存到磁盘。
会话数据存在 store.sessions[id]，运行时状态存在 store.runtime[id]。
调用示例：Session.get('session-xxx')、Session.create('workspace-xxx', 'openai', 'gpt-4')、Session.connect('session-xxx')。
*/
import { join } from 'node:path'                         // 引入文件路径拼接能力
import { rm } from 'node:fs/promises'                    // 引入文件删除能力
import { nanoid } from 'nanoid'                          // 引入唯一 ID 生成能力
import { store } from '../store.js'                      // 引入会话和工作区数据
import { File } from '../utils/file.js'                  // 引入原子写文件能力
import { SSE } from '../utils/sse.js'                    // 引入 SSE 连接能力
import { Workspace } from './workspace.js'               // 引入工作区保存能力


// --- 获取会话 ---
async function get(id) {
  if (store.sessions[id]) return { id, ...store.sessions[id] }
  const file = Bun.file(join(store.paths.sessions, `${id}.json`))
  if (!await file.exists()) return null
  store.sessions[id] = await file.json()                 // 从磁盘加载到内存
  store.runtime[id] = { status: 'idle', controller: null, clients: new Set(), tools: new Set(), approvals: new Map() } // 附属创建运行时
  return { id, ...store.sessions[id] }
}


// --- 创建会话 ---
async function create(workspaceId, provider, model) {
  const id = `session-${nanoid(10)}`
  store.sessions[id] = { messages: [], provider, model }
  store.runtime[id] = { status: 'idle', controller: null, clients: new Set(), tools: new Set(), approvals: new Map() } // 附属创建运行时
  store.workspaces[workspaceId].sessions.push({ id, title: '新对话', lastActiveAt: Date.now() })
  await save(id)
  await Workspace.save()
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
  if (store.runtime[id]?.status === 'running') return { error: '会话正在运行中，请先停止' }
  await rm(join(store.paths.sessions, `${id}.json`), { force: true })
  delete store.sessions[id]
  delete store.runtime[id]
  for (const workspace of Object.values(store.workspaces)) {
    workspace.sessions = workspace.sessions.filter((s) => s.id !== id)
  }
  await Workspace.save()
  return { id }
}


// --- 建立 SSE 连接 ---
function connect(id) {
  if (!store.runtime[id]) store.runtime[id] = { status: 'idle', controller: null, clients: new Set(), tools: new Set(), approvals: new Map() } // 连接时确保 runtime 存在
  const runtime = store.runtime[id]
  const { client, response } = SSE.connect((c) => runtime.clients.delete(c))
  const controller = client()
  runtime.clients.add(controller)
  SSE.send(controller, 'sync', { status: runtime.status, messageCount: store.sessions[id]?.messages?.length ?? 0 })
  return response
}


// --- 保存单个会话到磁盘 ---
async function save(id) {
  await File.write(join(store.paths.sessions, `${id}.json`), JSON.stringify(store.sessions[id], null, 2) + '\n')
}


export const Session = { get, create, update, remove, connect, save }
