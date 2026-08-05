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
import { Workspace } from './workspace.js'              // 引入工作区摘要保存动作

const encoder = new TextEncoder()                       // 所有 SSE 客户端共用 UTF-8 编码器
let sessionsDirectory = ''                              // 保存会话文件所在目录
const loadingSessions = new Map()                       // 同一会话的并发读取共享一个任务
const saveMutexes = new Map()                           // 每个会话一把互斥锁，保证保存串行
const removingSessions = new Set()                      // 删除期间拒绝重新加载或保存目标会话


// --- 初始化会话目录 ---
async function init(directory) {
  sessionsDirectory = directory                        // 后续保存和删除从该目录定位会话文件
  await mkdir(sessionsDirectory, { recursive: true })   // 首次启动时创建 sessions 目录
  store.sessions = {}                                   // 新应用从空的按需缓存开始
  loadingSessions.clear()                               // 新目录不能复用旧目录的读取任务
  saveMutexes.clear()                                   // 新目录不能复用旧互斥锁
  removingSessions.clear()                              // 新目录没有正在删除的旧会话
}


// --- 加载会话 ---
async function load(id) {
  if (removingSessions.has(id)) throw createError(404, 'session not found')
  if (store.sessions[id]) return store.sessions[id]     // 已加载时直接返回同一个真实对象
  const loading = loadingSessions.get(id)               // 检查是否已有调用方正在读取同一文件
  if (loading) return loading                            // 并发调用共享读取结果

  const pending = (async () => {
    const file = Bun.file(join(sessionsDirectory, `${id}.json`)) // 按 ID 定位会话文件
    if (!await file.exists()) throw createError(404, 'session not found')
    const session = withRuntime(await file.json())      // 恢复持久化数据和运行字段
    store.sessions[id] = session                        // 按 session ID 写入内存缓存
    return session                                      // 返回可直接操作的真实会话
  })()
  loadingSessions.set(id, pending)                      // 后续并发调用等待同一任务
  try { return await pending }                          // 反馈加载后的真实会话
  finally { loadingSessions.delete(id) }                // 读取结束后释放任务引用
}


// --- 获取会话 ---
function get(id) {
  return store.sessions[id] ?? null                     // 只读取内存，不隐式访问磁盘
}


// --- 创建会话 ---
async function create(workspaceId, provider, model) {
  const workspace = store.workspaces[workspaceId]       // 按 ID 直接读取会话所属工作区
  if (!workspace) throw createError(404, 'workspace not found')

  const now = Date.now()                                // 摘要时间使用统一基准
  const session = withRuntime({                         // 创建严格符合 store 的完整会话
    id: `session-${nanoid(10)}`,                        // 生成会话唯一身份
    status: 'idle',                                     // 新会话默认空闲
    messages: [],                                       // 新会话没有历史消息
    provider,                                            // 原样保存调用方选择的供应商
    model,                                               // 保存当前模型名称
  })
  workspace.sessions.push({ id: session.id, title: '新对话', lastActiveAt: now }) // 工作区只保存会话摘要
  store.sessions[session.id] = session                  // 完整会话按 ID 进入内存缓存
  await Promise.all([save(session.id), Workspace.save()]) // 同时保存完整会话和摘要
  return publicValue(session)                           // 返回新会话持久化数据
}


// --- 修改会话 ---
async function update(id, title, provider, model) {
  const session = get(id) ?? await load(id)             // 明确按需加载完整会话供修改
  const summary = findSummary(id)                       // 标题和最近时间只保存在工作区摘要

  if (title !== undefined) {
    if (!summary) throw createError(404, 'session workspace not found')
    summary.title = title                                // 更新工作区中的会话标题
  }
  if (provider !== undefined) session.provider = provider // 原样更新会话供应商字段
  if (model !== undefined) session.model = model         // 更新会话模型
  if (summary) summary.lastActiveAt = Date.now()        // 摘要存在时刷新列表时间
  await Promise.all([save(id), Workspace.save()])       // 两类数据一起持久化
  return publicValue(session)                           // 返回修改后的完整会话
}


// --- 删除会话 ---
async function remove(id, stopRunningSession) {
  const session = get(id) ?? await load(id)             // 明确按需加载运行状态
  const hasActiveRun = session.status === 'running' || session.abortController // 最终保存期间也属于活跃执行
  if (hasActiveRun && typeof stopRunningSession !== 'function') throw createError(409, 'running session must be stopped before removal')
  if (hasActiveRun) await stopRunningSession(id)         // 等待运行和最终保存结束，避免删除后文件重建
  if (session.abortController) throw createError(409, 'session is still running')

  removingSessions.add(id)                              // 从此刻起拒绝迟到保存和磁盘重载
  try {
    const mutex = saveMutexes.get(id)                   // 获取该会话的保存锁
    if (mutex) await mutex.waitForUnlock()              // 删除文件前等待正在进行的保存结束
    for (const client of session.clients) try { client.close() } catch {} // 删除前关闭全部 SSE 连接
    session.clients.clear()                             // 释放全部客户端引用
    await rm(join(sessionsDirectory, `${id}.json`), { force: true }) // 删除持久化会话文件
    delete store.sessions[id]                           // 从内存缓存移除完整会话
    for (const workspace of Object.values(store.workspaces)) workspace.sessions = workspace.sessions.filter((summary) => summary.id !== id) // 从所有工作区移除摘要
    await Workspace.save()                             // 保存摘要删除结果
    return { id }                                      // 返回被删除会话 ID
  } finally {
    saveMutexes.delete(id)                              // 删除结束后释放该会话互斥锁
    removingSessions.delete(id)                         // 后续同 ID 文件不存在时正常返回 404
  }
}


// --- 保存会话 ---
function save(id) {
  if (removingSessions.has(id)) throw createError(409, 'session is being removed')
  const session = store.sessions[id]                    // 保存只接受已经加载的会话
  if (!session) throw createError(404, 'session not found')
  if (!saveMutexes.has(id)) saveMutexes.set(id, new Mutex()) // 首次保存时为该会话创建互斥锁
  return saveMutexes.get(id).runExclusive(() => {       // 互斥保证同一会话的保存按顺序写入
    const json = JSON.stringify({ id: session.id, status: session.status, messages: session.messages, provider: session.provider, model: session.model }, null, 2) + '\n'
    return File.write(join(sessionsDirectory, `${id}.json`), json)
  })
}


// --- 建立 SSE 连接 ---
async function listen(id) {
  const session = get(id) ?? await load(id)             // SSE 连接明确按需加载目标会话
  let client                                             // 保存当前流控制器供断开清理
  let heartbeat                                          // 保存心跳定时器供断开清理
  const stream = new ReadableStream({
    start(controller) {
      client = controller                                // 记录本连接的写入控制器
      session.clients.add(client)                        // 新客户端加入会话集合
      client.enqueue(encoder.encode(': connected\n\n')) // 立即刷新真实网络响应，前端随后才能发送消息
      client.enqueue(encoder.encode(`event: sync\ndata: ${JSON.stringify({ status: session.status, messageCount: session.messages.length })}\n\n`)) // 连接时同步当前会话状态
      heartbeat = setInterval(() => {
        try { client.enqueue(encoder.encode(': ping\n\n')) } // 每 30 秒发送心跳保持连接存活
        catch { clearInterval(heartbeat); session.clients.delete(client) } // 写入失败时自动清理
      }, 30000)
    },
    cancel() {
      clearInterval(heartbeat)                           // 浏览器断开后停止心跳
      session.clients.delete(client)                     // 释放控制器引用
    },
  })
  return new Response(stream, {                         // 返回浏览器可识别的 SSE 响应
    headers: {
      'content-type': 'text/event-stream; charset=utf-8', // 声明事件流格式
      'cache-control': 'no-cache',                      // 禁止代理缓存实时内容
      connection: 'keep-alive',                         // 保持连接直到客户端关闭
    },
  })
}


// --- 发送 SSE 事件 ---
function emit(id, event, data) {
  const session = store.sessions[id]                    // 事件只发给已加载会话
  if (!session) return                                  // 会话已删除时忽略迟到事件
  const frame = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) // 编码最小 SSE 帧
  for (const client of [...session.clients]) {
    try { client.enqueue(frame) }                       // 向每个当前客户端发送同一事件
    catch { session.clients.delete(client) }            // 失效客户端立即从集合移除
  }
}


// --- 查找会话摘要 ---
function findSummary(id) {
  for (const workspace of Object.values(store.workspaces)) {
    const summary = workspace.sessions.find((item) => item.id === id) // 在工作区摘要中查找归属
    if (summary) return summary                         // 找到后返回真实可修改对象
  }
  return null                                           // 没有摘要时不猜测工作区
}


// --- 补齐运行时字段 ---
function withRuntime(saved) {
  return {
    id: saved.id,                                       // 保留持久化会话身份
    status: saved.status === 'error' ? 'error' : 'idle', // 重启后旧运行不能继续，运行中恢复为空闲
    messages: Array.isArray(saved.messages) ? saved.messages : [], // 恢复消息上下文
    provider: saved.provider ?? '',                     // 恢复会话供应商字段
    model: saved.model ?? '',                           // 恢复模型名称
    abortController: null,                              // 新进程没有模型请求
    clients: new Set(),                                 // 新进程没有 SSE 客户端
    tools: new Set(),                                   // 新进程没有正在运行的工具
  }
}


// --- 创建公开和持久化会话 ---
function publicValue(session) {
  return structuredClone({                             // 只返回 store 中需要持久化的五个字段
    id: session.id,
    status: session.status,
    messages: session.messages,
    provider: session.provider,
    model: session.model,
  })
}


export const Session = { init, load, get, create, update, remove, save, listen, emit } // 导出会话数据和 SSE 指令
