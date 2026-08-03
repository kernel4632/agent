/*
会话指令集：按需加载、创建、修改、删除和保存会话，并管理每个会话的 SSE 客户端。
完整会话不保存工作区 ID；工作区与会话的关系只存在 workspaces.sessions 摘要中。
调用示例：await Session.create(workspaceId, provider, model)、await Session.emit(id, 'status', { status: 'running' })。
*/
import { mkdir, rm } from 'node:fs/promises'            // 引入会话目录创建和文件删除能力
import { join } from 'node:path'                        // 引入会话文件路径拼接能力
import { nanoid } from 'nanoid'                         // 引入会话和消息唯一 ID 生成能力
import { store } from '../store.js'                     // 引入会话与工作区数据
import { Workspace } from './workspace.js'              // 引入工作区摘要保存动作

const encoder = new TextEncoder()                       // 所有 SSE 客户端共用 UTF-8 编码器
let sessionsDirectory = ''                              // 保存会话文件所在目录


// --- 准备会话目录 ---
async function load(directory) {
  sessionsDirectory = directory                        // 按需加载时从该目录定位会话文件
  await mkdir(sessionsDirectory, { recursive: true })   // 首次启动时创建 sessions 目录
  store.sessions = []                                   // 新应用实例不继承旧进程中的会话引用
}


// --- 获取公开会话 ---
async function get(id) {
  const session = await getMutable(id)                  // 按需恢复完整会话
  if (!session) throw businessError(404, 'session not found') // 未找到时返回资源错误
  return publicValue(session)                           // API 只返回可持久化字段
}


// --- 获取可修改会话 ---
async function getMutable(id) {
  const loaded = store.sessions.find((session) => session.id === id) // 优先复用内存中的会话
  if (loaded) return loaded                             // 运行时 Set 和控制器必须保持同一引用
  if (!sessionsDirectory) throw new Error('sessions have not been loaded') // 未初始化时无法定位文件

  const file = Bun.file(join(sessionsDirectory, `${id}.json`)) // 按 ID 定位持久化会话
  if (!await file.exists()) return null                 // 文件不存在时反馈空值
  const saved = await file.json()                       // 读取严格的持久化字段
  const session = withRuntime(saved)                    // 补上四个内存字段
  store.sessions.push(session)                          // 加入已加载会话列表
  return session                                        // 返回可修改真实对象
}


// --- 创建会话 ---
async function create(workspaceId, provider, model) {
  const workspace = Workspace.getMutable(workspaceId)  // 会话摘要必须归入现有工作区
  if (!workspace) throw businessError(404, 'workspace not found') // 不创建游离会话
  if (typeof model !== 'string' || !model.trim()) throw businessError(400, 'model must not be empty') // 模型为空无法请求 LLM

  const now = Date.now()                                // 摘要时间使用统一基准
  const session = withRuntime({                         // 创建严格符合 store 的完整会话
    id: `session-${nanoid(10)}`,                        // 生成会话唯一身份
    status: 'idle',                                     // 新会话默认空闲
    messages: [],                                       // 新会话没有历史消息
    provider: typeof provider === 'string' ? provider : '', // 原样保存调用方选择的供应商
    model: model.trim(),                                // 保存当前模型名称
  })
  workspace.sessions.push({ id: session.id, title: '新对话', lastActiveAt: now }) // 工作区只保存会话摘要
  store.sessions.push(session)                          // 完整会话进入内存列表
  await Promise.all([save(session.id), Workspace.save()]) // 同时保存完整会话和摘要
  return publicValue(session)                           // 返回新会话持久化数据
}


// --- 修改会话 ---
async function update(id, title, provider, model) {
  const session = await getMutable(id)                  // 读取完整会话供供应商和模型修改
  if (!session) throw businessError(404, 'session not found') // 不允许修改不存在的会话
  const summary = findSummary(id)                       // 标题和最近时间只保存在工作区摘要

  if (title !== undefined) {
    if (!summary) throw businessError(404, 'session workspace not found') // 标题没有摘要时无法确定写入位置
    if (typeof title !== 'string' || !title.trim()) throw businessError(400, 'title must not be empty') // 空标题不能用于会话列表
    summary.title = title.trim()                         // 更新工作区中的会话标题
  }
  if (provider !== undefined) session.provider = provider // 原样更新会话供应商字段
  if (model !== undefined) {
    if (typeof model !== 'string' || !model.trim()) throw businessError(400, 'model must not be empty') // 空模型无法执行
    session.model = model.trim()                         // 更新会话模型
  }
  if (summary) summary.lastActiveAt = Date.now()        // 摘要存在时刷新列表时间
  await Promise.all([save(id), Workspace.save()])       // 两类数据一起持久化
  return publicValue(session)                           // 返回修改后的完整会话
}


// --- 删除会话 ---
async function remove(id) {
  const session = await getMutable(id)                  // 读取运行状态以决定是否先停止
  if (!session) throw businessError(404, 'session not found') // 不存在时返回资源错误
  if (session.status === 'running') {
    const { Agent } = await import('./agent.js')        // 删除路径按需加载 Agent，避免模块循环初始化
    await Agent.stop(id)                                // 先停止模型请求和工具进程
  }

  closeClients(session)                                 // 删除前关闭全部 SSE 连接
  await rm(join(sessionsDirectory, `${id}.json`), { force: true }) // 删除持久化会话文件
  store.sessions = store.sessions.filter((item) => item.id !== id) // 从内存列表移除完整会话
  for (const workspace of store.workspaces) workspace.sessions = workspace.sessions.filter((summary) => summary.id !== id) // 从所有工作区移除摘要
  await Workspace.save()                               // 保存摘要删除结果
  return { id }                                        // 返回被删除会话 ID
}


// --- 保存会话 ---
async function save(id) {
  const session = store.sessions.find((item) => item.id === id) // 保存只接受已经加载的会话
  if (!session) throw businessError(404, 'session not found') // 未加载会话没有可保存数据
  const snapshot = publicValue(session)                 // 排除四个运行时字段
  await Bun.write(join(sessionsDirectory, `${id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`) // 每个会话一个 JSON 文件
}


// --- 建立 SSE 连接 ---
async function listen(id) {
  const session = await getMutable(id)                  // SSE 客户端直接挂在目标会话上
  if (!session) throw businessError(404, 'session not found') // 不为未知会话建立连接
  let client                                             // 保存当前流控制器供断开清理
  const stream = new ReadableStream({
    start(controller) {
      client = controller                                // 记录本连接的写入控制器
      session.clients.add(client)                        // 新客户端加入会话集合
    },
    cancel() {
      session.clients.delete(client)                     // 浏览器断开后释放控制器引用
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
  const session = store.sessions.find((item) => item.id === id) // 事件只发给已加载会话
  if (!session) return                                  // 会话已删除时忽略迟到事件
  const frame = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) // 编码最小 SSE 帧
  for (const client of [...session.clients]) {
    try { client.enqueue(frame) }                       // 向每个当前客户端发送同一事件
    catch { session.clients.delete(client) }            // 失效客户端立即从集合移除
  }
}


// --- 创建消息 ID ---
function createMessageId() {
  return `message-${nanoid(12)}`                        // 用户、助手和工具消息共享同一 ID 格式
}


// --- 查找会话摘要 ---
function findSummary(id) {
  for (const workspace of store.workspaces) {
    const summary = workspace.sessions.find((item) => item.id === id) // 在工作区摘要中查找归属
    if (summary) return summary                         // 找到后返回真实可修改对象
  }
  return null                                           // 没有摘要时不猜测工作区
}


// --- 查找会话工作目录 ---
function getWorkspacePath(id) {
  return store.workspaces.find((workspace) => workspace.sessions.some((summary) => summary.id === id))?.path ?? process.cwd() // 工具默认使用会话所属工作区
}


// --- 补齐运行时字段 ---
function withRuntime(saved) {
  return {
    id: saved.id,                                       // 保留持久化会话身份
    status: saved.status === 'error' ? 'error' : 'idle', // 重启后旧运行不能继续，运行中恢复为空闲
    messages: Array.isArray(saved.messages) ? saved.messages : [], // 恢复消息上下文
    provider: saved.provider ?? '',                     // 恢复会话供应商字段
    model: saved.model ?? '',                           // 恢复模型名称
    processes: new Set(),                               // 新进程尚未启动工具
    abortController: null,                              // 新进程没有模型请求
    clients: new Set(),                                 // 新进程没有 SSE 客户端
    textOnlyCount: 0,                                   // 新执行从零统计纯文本轮次
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


// --- 关闭会话客户端 ---
function closeClients(session) {
  for (const client of session.clients) {
    try { client.close() } catch {}                    // 单个连接异常不能阻止其他连接关闭
  }
  session.clients.clear()                              // 清除全部控制器引用
}


// --- 创建业务错误 ---
function businessError(status, message) {
  return Object.assign(new Error(message), { status }) // 让 server.js 统一转换 HTTP 状态
}


export const Session = { load, get, getMutable, create, update, remove, save, listen, emit, createMessageId, getWorkspacePath, closeClients } // 导出会话最小动作
