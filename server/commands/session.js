/*
会话指令集：初始化目录，按 ID 加载、读取、创建、修改、删除和保存会话，并收发 SSE 事件。
完整会话不保存工作区 ID；工作区与会话的关系只存在 workspaces.sessions 摘要中。
调用示例：await Session.create(workspaceId, provider, model)、await Session.emit(id, 'status', { status: 'running' })。
*/
import { mkdir, rm } from 'node:fs/promises'            // 引入会话目录创建和文件删除能力
import { join } from 'node:path'                        // 引入会话文件路径拼接能力
import { Mutex } from 'async-mutex'                     // 引入互斥锁保证每个会话保存串行
import createError from 'http-errors'                   // 引入标准 HTTP 错误创建
import { nanoid } from 'nanoid'                         // 引入会话唯一 ID 生成能力
import { store } from '../store.js'                     // 引入会话与工作区数据
import { File } from '../utils/file.js'                 // 引入完整文件替换能力
import { SSE } from '../utils/sse.js'                   // 引入 SSE 帧编码和广播能力
import { Workspace } from './workspace.js'              // 引入工作区摘要保存动作

let directory = ''                                      // 保存会话文件所在目录
const loading = new Map()                               // 同一会话的并发读取共享一个任务
const locks = new Map()                                 // 每个会话一把互斥锁，保证保存串行
const removing = new Set()                              // 删除期间拒绝重新加载或保存目标会话


// --- 初始化会话目录 ---
async function init(dir) {
  directory = dir                                       // 后续保存和删除从该目录定位会话文件
  await mkdir(directory, { recursive: true })            // 首次启动时创建 sessions 目录
  store.sessions = {}                                   // 新应用从空的按需缓存开始
  loading.clear()                                       // 新目录不能复用旧目录的读取任务
  locks.clear()                                         // 新目录不能复用旧互斥锁
  removing.clear()                                      // 新目录没有正在删除的旧会话
}


// --- 加载会话 ---
async function load(id) {
  if (removing.has(id)) throw createError(404, 'session not found')
  if (store.sessions[id]) return store.sessions[id]     // 已加载时直接返回同一个真实对象
  const pending = loading.get(id)                       // 检查是否已有调用方正在读取同一文件
  if (pending) return pending                            // 并发调用共享读取结果

  const task = (async () => {
    const file = Bun.file(join(directory, `${id}.json`))
    if (!await file.exists()) throw createError(404, 'session not found')
    const session = hydrate(await file.json())           // 恢复持久化数据和运行字段
    store.sessions[id] = session                        // 按 session ID 写入内存缓存
    return session
  })()
  loading.set(id, task)                                 // 后续并发调用等待同一任务
  try { return await task }
  finally { loading.delete(id) }
}


// --- 获取会话 ---
function get(id) {
  return store.sessions[id] ?? null                     // 只读取内存，不隐式访问磁盘
}


// --- 创建会话 ---
async function create(workspaceId, provider, model) {
  const workspace = store.workspaces[workspaceId]
  if (!workspace) throw createError(404, 'workspace not found')

  const now = Date.now()
  const session = hydrate({
    id: `session-${nanoid(10)}`,
    status: 'idle',
    messages: [],
    provider,
    model,
  })
  workspace.sessions.push({ id: session.id, title: '新对话', lastActiveAt: now })
  store.sessions[session.id] = session
  await Promise.all([save(session.id), Workspace.save()])
  return snapshot(session)
}


// --- 修改会话 ---
async function update(id, title, provider, model) {
  const session = get(id) ?? await load(id)
  const found = summary(id)

  if (title !== undefined) {
    if (!found) throw createError(404, 'session workspace not found')
    found.title = title
  }
  if (provider !== undefined) session.provider = provider
  if (model !== undefined) session.model = model
  if (found) found.lastActiveAt = Date.now()
  await Promise.all([save(id), Workspace.save()])
  return snapshot(session)
}


// --- 删除会话 ---
async function remove(id, stopRunningSession) {
  const session = get(id) ?? await load(id)
  const hasActiveRun = session.status === 'running' || session.abortController
  if (hasActiveRun && typeof stopRunningSession !== 'function') throw createError(409, 'running session must be stopped before removal')
  if (hasActiveRun) await stopRunningSession(id)
  if (session.abortController) throw createError(409, 'session is still running')

  removing.add(id)
  try {
    const mutex = locks.get(id)
    if (mutex) await mutex.waitForUnlock()
    for (const client of session.clients) try { client.close() } catch {}
    session.clients.clear()
    await rm(join(directory, `${id}.json`), { force: true })
    delete store.sessions[id]
    for (const workspace of Object.values(store.workspaces)) workspace.sessions = workspace.sessions.filter((summary) => summary.id !== id)
    await Workspace.save()
    return { id }
  } finally {
    locks.delete(id)
    removing.delete(id)
  }
}


// --- 保存会话 ---
function save(id) {
  if (removing.has(id)) throw createError(409, 'session is being removed')
  const session = store.sessions[id]
  if (!session) throw createError(404, 'session not found')
  if (!locks.has(id)) locks.set(id, new Mutex())
  return locks.get(id).runExclusive(() => {
    const json = JSON.stringify({ id: session.id, status: session.status, messages: session.messages, provider: session.provider, model: session.model }, null, 2) + '\n'
    return File.write(join(directory, `${id}.json`), json)
  })
}


// --- 建立 SSE 连接 ---
async function listen(id) {
  const session = get(id) ?? await load(id)
  const { client, response } = SSE.connect((controller) => session.clients.delete(controller)) // 断开时自动移除
  session.clients.add(client())                         // 新客户端加入会话集合
  SSE.send(client(), 'sync', { status: session.status, messageCount: session.messages.length }) // 连接时同步当前状态
  return response
}


// --- 发送 SSE 事件 ---
function emit(id, event, data) {
  const session = store.sessions[id]
  if (!session) return                                  // 会话已删除时忽略迟到事件
  SSE.broadcast(session.clients, event, data)
}


// --- 查找会话摘要 ---
function summary(id) {
  for (const workspace of Object.values(store.workspaces)) {
    const summary = workspace.sessions.find((item) => item.id === id)
    if (summary) return summary
  }
  return null
}


// --- 补齐运行时字段 ---
function hydrate(saved) {
  return {
    id: saved.id,
    status: saved.status === 'error' ? 'error' : 'idle',
    messages: Array.isArray(saved.messages) ? saved.messages : [],
    provider: saved.provider ?? '',
    model: saved.model ?? '',
    abortController: null,
    clients: new Set(),
    tools: new Set(),
  }
}


// --- 创建可序列化会话快照 ---
function snapshot(session) {
  return structuredClone({
    id: session.id,
    status: session.status,
    messages: session.messages,
    provider: session.provider,
    model: session.model,
  })
}


export const Session = { init, load, get, create, update, remove, save, listen, emit }
