/*
会话指令集：负责会话的创建、查询、删除、持久化、回滚与撤销。
所有业务修改先落到 sessionStore.items，再通过 unstorage 同步到真实磁盘。
调用示例：await Session.create()、await Session.rollback('ses_xxx', 2)。
*/
import { createStorage } from 'unstorage'             // 引入统一键值存储能力
import fsDriver from 'unstorage/drivers/fs'           // 引入真实文件系统存储驱动
import { nanoid } from 'nanoid'                       // 引入紧凑唯一 ID 生成能力
import { streamText } from 'ai'                        // 引入真实模型流调用
import { store } from '../store.js'                    // 引入服务端唯一状态根
import { Config } from './config.js'                   // 引入当前模型配置
import { Agent } from './agent.js'                     // 引入本轮模型快照解析
import { SSE } from '../utils/sse.js'                  // 引入事件帧编码
import { Workspace } from './workspace.js'             // 引入工作区归属校验

const sessionStore = store.sessions                       // 当前指令使用会话领域状态


// --- 加载磁盘会话 ---
async function load(directory) {
  sessionStore.storage = createStorage({              // 将每个会话映射为目录内的 JSON 数据
    driver: fsDriver({ base: directory }),            // 使用当前应用数据目录，测试与用户数据相互隔离
  })
  sessionStore.items.clear()                          // 重载前清除旧运行时状态
  sessionStore.writes.clear()                         // 启动加载时不存在尚未完成的旧进程写入

  const sessionIDs = await sessionStore.storage.getKeys() // 枚举磁盘上已有的全部会话键
  for (const sessionID of sessionIDs) {               // 逐个恢复会话，保证服务重启后历史可用
    const session = await sessionStore.storage.getItem(sessionID) // 读取完整会话数据
    if (!session?.id) continue                        // 忽略无效存储项，避免污染列表
    normalizeSession(session)                         // 为旧会话补齐消息 ID 和模型边界
    sessionStore.items.set(sessionID, session)        // 将可回退的完整会话加入运行时状态
  }
}


// --- 创建空会话 ---
async function create(options = {}) {
  const workspaceID = options.workspaceID || Workspace.getDefaultID() // 未指定时绑定首次启动创建的默认工作区
  if (!Workspace.get(workspaceID)) return { ok: false, status: 404, error: 'workspace not found' } // 会话不能引用不存在的工作区

  const now = Date.now()                              // 创建和更新时间从同一个时刻开始
  const session = {                                   // 显式定义持久化会话的全部字段
    id: `ses_${nanoid(10)}`,                          // 会话唯一标识，用作 API 和磁盘键
    workspaceID,                                      // 所属工作区决定主页归类和工具执行目录
    workspaceId: workspaceID,                          // 架构契约字段，保留 camelCase HTTP 数据形状
    model: options.model || Config.get().activeModel || '', // 保存设置页和操作框选择的模型名称
    status: 'idle',                                   // 会话当前执行状态供列表和顶部栏展示
    title: '',                                        // 首条消息后由模型异步生成标题
    titleSource: 'generated',                         // 标记标题归属，异步生成不能覆盖用户重命名
    createdAt: now,                                   // 会话创建时间，Unix 毫秒
    updatedAt: now,                                   // 最近一次消息或回滚修改时间
    lastActiveAt: now,                                // 最近交互时间用于设计要求的时间分组
    tasks: [],                                        // 当前会话的持久化任务清单
    taskRevision: 0,                                  // 每次任务修改递增，供客户端检测并发覆盖
    messages: [],                                     // 完整用户、助手与工具消息历史
    rollbackCache: null,                              // 最近一次回滚截断的消息，供撤销使用
    modelMessages: [],                                // AI SDK 标准历史与展示历史同步回退
  }
  await persist(session)                              // 候选会话先写盘，失败时不污染运行时目录
  sessionStore.items.set(session.id, session)         // 持久化成功后将新会话加入运行时映射
  initialize(session.id)                              // 正式提交后建立独立 SSE 订阅
  emit(session.id, 'session-created', { id: session.id, workspaceID: session.workspaceID }) // 事件订阅可观察会话创建身份
  return structuredClone(session)                    // 返回副本，避免入口直接改状态
}


// --- 修改会话配置 ---
async function update(sessionID, changes = {}) {
  const session = getMutable(sessionID)               // 从运行时状态读取目标会话
  if (!session) return { ok: false, status: 404, error: 'session not found' } // 不存在时拒绝隐式创建

  const candidate = structuredClone(session)           // 多字段修改先在独立候选值上完整验证
  if ('title' in changes) {
    const title = typeof changes.title === 'string' ? changes.title.trim() : '' // 清理标题首尾空白
    if (!title) return { ok: false, status: 400, error: 'title must not be empty' } // 空标题保持当前会话不变
    if (title.length > 100) return { ok: false, status: 400, error: 'title must be at most 100 characters' } // 限制列表布局
    candidate.title = title                              // 候选会话保存用户标题
    candidate.titleSource = 'user'                       // 用户标题阻止异步模型覆盖
  }
  if ('model' in changes) {
    const model = typeof changes.model === 'string' ? changes.model.trim() : '' // 清理操作框选择的模型名称
    if (!model) return { ok: false, status: 400, error: 'model must not be empty' } // 空模型无法启动真实请求
    candidate.model = model                             // 候选会话保存模型选择
  }
  await persist(candidate)                              // 全部字段验证后先持久化候选值
  Object.assign(session, candidate)                     // 写盘成功后原位提交，保持运行循环持有的会话引用有效
  return { ok: true, ...(changes.title !== undefined ? { title: candidate.title, titleSource: candidate.titleSource } : {}), ...(changes.model !== undefined ? { model: candidate.model } : {}), session: get(sessionID) } // 反馈修改字段和完整会话
}


// --- 重命名会话 ---
async function rename(sessionID, title) {
  const result = await update(sessionID, { title })    // 复用多字段原子验证和持久化路径
  if (!result.ok) return result                        // 将明确验证错误原样反馈入口
  return { ok: true, title: result.session.title, titleSource: result.session.titleSource } // 返回标题编辑器需要的字段
}


// --- 更新会话任务清单 ---
async function updateTasks(sessionID, tasks, expectedRevision) {
  const session = getMutable(sessionID)               // 从运行时状态读取目标会话
  if (!session) return { ok: false, status: 404, error: 'session not found' } // 不存在时不能创建游离任务
  if (expectedRevision !== undefined && expectedRevision !== session.taskRevision) return { ok: false, status: 409, error: 'task revision conflict', taskRevision: session.taskRevision } // 旧客户端不能覆盖较新清单

  const error = validateTasks(tasks)                  // 在修改共享状态前完整验证任务结构
  if (error) return { ok: false, status: 400, error } // 无效任务保持原清单和修订号不变

  const candidate = structuredClone(session)          // 在独立候选会话中修改任务和修订号
  candidate.tasks = structuredClone(tasks)            // 保存副本，避免工具输入随后修改共享状态
  candidate.taskRevision += 1                         // 每次成功替换都产生新的并发版本
  await persist(candidate)                            // 任务与修订号作为一个候选记录写盘
  Object.assign(session, candidate)                    // 原位提交，避免运行循环继续持有过期对象
  return { ok: true, tasks: structuredClone(candidate.tasks), taskRevision: candidate.taskRevision } // 反馈最新持久化状态
}


// --- 验证任务清单 ---
function validateTasks(tasks) {
  if (!Array.isArray(tasks)) return 'tasks must be an array' // API 和工具都必须提交完整数组
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return 'each task must be an object' // 拒绝空值和嵌套数组
    if (typeof task.content !== 'string' || !task.content.trim()) return 'task content must not be empty' // 每项必须说明可执行内容
    if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(task.status)) return 'invalid task status' // 状态只允许工作台定义值
    if (!['high', 'medium', 'low'].includes(task.priority)) return 'invalid task priority' // 优先级只允许工作台定义值
  }
  return null                                         // 全部任务通过验证后允许替换
}


// --- 列出会话摘要 ---
function list(workspaceID) {
  return [...sessionStore.items.values()]             // 从运行时映射读取全部会话
    .filter((session) => !workspaceID || session.workspaceID === workspaceID) // 工作区主页只读取自己的会话
    .sort((left, right) => right.updatedAt - left.updatedAt) // 最近更新的会话优先展示
    .map(({ id, workspaceID, title, model, status, createdAt, updatedAt, lastActiveAt, messages }) => ({ // API 列表不泄漏完整消息
      id, sessionId: id, workspaceID, workspaceId: workspaceID, title, model, status, createdAt, updatedAt, lastActiveAt, messageCount: messages.length, // 同时反馈设计字段和兼容字段
    }))
}


// --- 获取完整会话 ---
function get(sessionID) {
  const session = sessionStore.items.get(sessionID)   // 根据路由参数读取目标会话
  if (!session) return null                            // 不存在时返回空值供入口转换为 404
  const visibleSession = structuredClone(session)     // 返回副本，防止入口直接修改状态
  delete visibleSession.modelMessages                 // 模型协议历史是内部数据，不属于会话 API 展示结构
  visibleSession.rollback = createRollbackSummary(visibleSession.rollbackCache) // 仅公开撤销栏需要的摘要
  delete visibleSession.rollbackCache                 // 被截断的完整历史不重复发送到浏览器
  return visibleSession                                // 反馈 README 规定的完整用户可见会话
}


// --- 获取可修改会话引用 ---
function getMutable(sessionID) {
  return sessionStore.items.get(sessionID) ?? null    // 仅供 commands 内部显式修改会话数据
}


// --- 持久化会话 ---
async function persist(session) {
  session.updatedAt = Date.now()                      // 每次成功修改都刷新列表排序时间
  session.lastActiveAt = session.updatedAt            // 设计中的最近活动时间与真实修改保持一致
  const snapshot = structuredClone(session)           // 保存调用时快照，后续内存修改不能改变本次写入内容
  const previousWrite = sessionStore.writes.get(session.id) ?? Promise.resolve() // 读取该会话前一次写入
  const currentWrite = previousWrite.catch(() => {}).then(() => sessionStore.storage.setItem(session.id, snapshot)) // 即使旧写入失败也按调用顺序继续最新保存
  sessionStore.writes.set(session.id, currentWrite)   // 后续保存排在本次写入之后
  try { await currentWrite }                          // 调用方等待自己的持久化完成
  finally { if (sessionStore.writes.get(session.id) === currentWrite) sessionStore.writes.delete(session.id) } // 最后一笔完成后释放队列
}


// --- 删除会话 ---
async function remove(sessionID) {
  if (!sessionStore.items.has(sessionID)) {           // 不存在的会话无法删除
    return { ok: false, error: 'session not found' }
  }

  await sessionStore.writes.get(sessionID)?.catch(() => {}) // 等待较早保存结束，避免删除后旧写入重建文件
  await sessionStore.storage.removeItem(sessionID)    // 先移除磁盘记录，失败时保留可访问的运行时状态
  sessionStore.items.delete(sessionID)                // 磁盘删除成功后移除运行时数据
  removeEvents(sessionID)                             // 同步清理该会话的事件历史和订阅状态
  return { ok: true }                                 // 向 HTTP 入口反馈删除完成
}


// --- 安全删除一个非运行会话 ---
async function removeSafely(sessionID) {
  if (isSessionRunning(sessionID)) return { ok: false, status: 409, error: 'session is running' } // 执行期间不能删除历史
  return remove(sessionID)                                               // 空闲会话进入原子磁盘删除路径
}


// --- 回滚到工具步骤 ---
async function rollback(sessionID, step) {
  const session = getMutable(sessionID)               // 读取需要截断的真实会话对象
  if (!session) return { ok: false, error: 'session not found' } // 会话不存在时拒绝回滚
  const candidate = structuredClone(session)          // 旧回退恢复和新边界都只修改候选值
  restoreRollbackCache(candidate)                     // 候选历史先恢复完整状态以移动回退边界

  let lastToolIndex = -1                              // 默认表示没有找到目标存档点
  candidate.messages.forEach((message, index) => {    // 查找并行工具中目标步骤的最后一条
    if (message.role === 'tool' && message.step === step) lastToolIndex = index // 同步骤工具应整体保留
  })
  if (lastToolIndex < 0) return { ok: false, error: 'checkpoint not found' } // 无目标步骤时保持数据不变

  const target = candidate.messages[lastToolIndex]    // 保存目标工具供模型边界定位
  const modelBoundary = findToolModelBoundary(candidate.modelMessages, target.toolCallId) // 找到模型工具结果之后的位置
  stageRollback(candidate, lastToolIndex + 1, modelBoundary, { type: 'checkpoint', step }) // 两套候选历史同步暂存
  await persist(candidate)                            // 回滚候选值与缓存一并写盘
  Object.assign(session, candidate)                    // 写盘成功后原位提交回退状态
  return { ok: true, remainingMessages: candidate.messages.length } // 反馈当前剩余消息数
}


// --- 回滚到用户消息并准备重新发送 ---
async function rollbackMessage(sessionID, messageID) {
  const session = getMutable(sessionID)               // 读取目标会话的真实历史
  if (!session) return { ok: false, error: 'session not found' } // 不存在时拒绝回退
  const candidate = structuredClone(session)          // 候选值支持移动回退且不污染失败路径
  restoreRollbackCache(candidate)                     // 在候选历史中恢复完整状态

  const messageIndex = candidate.messages.findIndex((item) => item.id === messageID && item.role === 'user') // 定位稳定用户消息
  if (messageIndex < 0) return { ok: false, error: 'user message not found' } // 只能回退到真实用户轮次

  const target = candidate.messages[messageIndex]     // 保存原文供前端恢复输入框
  const modelBoundary = findUserModelBoundary(candidate, messageIndex) // 找到该用户消息进入模型历史前的位置
  stageRollback(candidate, messageIndex, modelBoundary, { type: 'message', messageID, content: target.content }) // 暂存目标消息及后续历史
  await persist(candidate)                            // 回退候选值真实写盘
  Object.assign(session, candidate)                    // 写盘成功后原位提交回退状态
  return { ok: true, remainingMessages: candidate.messages.length, content: target.content } // 反馈可重新编辑的原文
}


// --- 撤销最近回滚 ---
async function undoRollback(sessionID) {
  const session = getMutable(sessionID)               // 读取包含回滚缓存的真实会话对象
  if (!session) return { ok: false, error: 'session not found' } // 会话不存在时拒绝操作
  if (!session.rollbackCache) return { ok: false, error: 'no rollback to undo' } // 没有缓存时不能恢复

  const restoredMessages = Array.isArray(session.rollbackCache) ? session.rollbackCache.length : session.rollbackCache.messages.length // 兼容旧数组缓存
  const candidate = structuredClone(session)          // 撤销也通过独立候选值保持失败原子性
  restoreRollbackCache(candidate)                     // 按原顺序恢复展示和模型历史
  await persist(candidate)                            // 恢复后的完整候选历史真实写盘
  Object.assign(session, candidate)                    // 写盘成功后原位提交恢复状态
  return { ok: true, restoredMessages }               // 反馈恢复的消息数量
}


// --- 提交暂存回退 ---
function commitRollback(session) {
  session.rollbackCache = null                        // 新消息发送后丢弃暂存历史，正式形成分支
}


// --- 统一旧会话结构 ---
function normalizeSession(session, initializeEvents = true) {
  session.workspaceID ??= session.workspaceId ?? Workspace.getDefaultID() // 优先保留备份中的正式 camelCase 归属，旧会话才使用默认工作区
  session.workspaceId = session.workspaceID             // 两种兼容字段始终指向同一工作区
  session.model ??= Config.get().activeModel || ''     // 旧会话补齐当前默认模型
  session.status = 'idle'                              // 服务重启后旧执行不可能仍在运行
  session.title ??= ''                                // 旧会话缺少标题时保持可生成状态
  session.titleSource ??= 'generated'                 // 旧标题视为模型生成，后续用户重命名会明确接管
  session.tasks ??= []                                // 旧会话补齐空任务清单
  session.taskRevision ??= 0                          // 旧任务清单从初始修订开始
  session.messages ??= []                             // 旧空会话补齐展示历史
  session.lastActiveAt ??= session.updatedAt ?? session.createdAt ?? Date.now() // 旧会话补齐时间分组字段
  session.modelMessages ??= []                        // 旧会话缺少模型历史时保持可继续发送
  session.messages.forEach((message) => { message.id ??= `msg_${nanoid(10)}` }) // 每条消息获得稳定 UI 动作标识
  session.rollbackCache ??= null                      // 旧文件补齐可撤销状态
  session.messages.forEach(normalizeMessage)          // 旧展示消息升级为统一 contentBlocks 结构
  if (initializeEvents) initialize(session.id)        // 真实恢复时建立事件状态，纯验证保持无副作用
}


// --- 统一公开消息结构 ---
function normalizeMessage(message) {
  message.id ??= `msg_${nanoid(10)}`                  // 每条消息必须有稳定回退和复制身份
  message.contentBlocks ??= []                        // 内容块是前端唯一的复合渲染入口
  if (message.content && message.contentBlocks.length === 0) message.contentBlocks.push({ type: 'text', text: { text: message.content } }) // 旧纯文本升级为文本块
  if (message.reasoning && !message.contentBlocks.some((block) => block.type === 'thinking')) message.contentBlocks.unshift({ type: 'thinking', thinking: { thinking: message.reasoning } }) // 旧推理升级为折叠块
  message.checkpoint ??= null                         // 非工具消息默认没有存档点
  message.rolledBack ??= false                        // 当前可见历史默认未被回退
  message.createdAt ??= Date.now()                    // 旧消息补齐发送时间供界面展示
}


// --- 暂存指定边界后的两套历史 ---
function stageRollback(session, messageIndex, modelIndex, target) {
  session.rollbackCache = {                           // 保存撤销所需的完整数据和界面摘要
    messages: session.messages.splice(messageIndex), // 展示历史立即隐藏目标边界之后内容
    modelMessages: session.modelMessages.splice(modelIndex), // 模型下一轮也看不到已回退内容
    target,                                           // 前端据此展示撤销状态和编辑原文
  }
}


// --- 恢复当前暂存历史 ---
function restoreRollbackCache(session) {
  if (!session.rollbackCache) return                  // 没有暂存时保持会话不变
  if (Array.isArray(session.rollbackCache)) {         // 兼容旧版本仅保存展示消息的缓存
    session.messages.push(...session.rollbackCache)   // 恢复旧展示历史
  } else {
    session.messages.push(...session.rollbackCache.messages) // 恢复完整展示时间线
    session.modelMessages.push(...session.rollbackCache.modelMessages) // 恢复完整模型上下文
  }
  session.rollbackCache = null                        // 恢复后清除一次性撤销状态
}


// --- 定位用户消息对应的模型边界 ---
function findUserModelBoundary(session, messageIndex) {
  const userNumber = session.messages.slice(0, messageIndex + 1).filter((item) => item.role === 'user').length // 计算目标是第几个用户轮次
  let seenUsers = 0                                   // 按模型历史顺序匹配同一用户轮次
  for (let index = 0; index < session.modelMessages.length; index += 1) {
    if (session.modelMessages[index].role !== 'user') continue // 非用户协议消息不参与计数
    seenUsers += 1                                    // 找到下一个用户轮次
    if (seenUsers === userNumber) return index        // 回退边界位于目标用户消息之前
  }
  return session.modelMessages.length                 // 旧异常历史回退到安全末尾，避免误删更早上下文
}


// --- 定位工具结果后的模型边界 ---
function findToolModelBoundary(modelMessages, toolCallID) {
  const index = modelMessages.findIndex((message) => message.role === 'tool' && message.content?.some?.((part) => part.toolCallId === toolCallID)) // 按稳定调用 ID 匹配协议工具结果
  return index < 0 ? modelMessages.length : index + 1 // 保留目标工具结果，旧历史找不到时不误删上下文
}


// --- 创建公开回退摘要 ---
function createRollbackSummary(rollbackCache) {
  if (!rollbackCache) return null                     // 正常会话不展示撤销栏
  if (Array.isArray(rollbackCache)) return { count: rollbackCache.length, target: null } // 兼容旧缓存摘要
  return { count: rollbackCache.messages.length, target: rollbackCache.target } // 隐藏完整消息，仅反馈数量和目标
}


// --- 导出全部完整会话 ---
function exportAll() {
  return [...sessionStore.items.values()].map((session) => structuredClone(session)) // 备份保留模型历史和回退缓存
}


// --- 替换全部会话 ---
function validateAll(sessions, workspaceIDs = new Set(Workspace.list().map((workspace) => workspace.id))) {
  if (!Array.isArray(sessions)) return { ok: false, status: 400, error: 'sessions must be an array' } // 备份必须提供完整数组
  const normalized = sessions.map((session) => structuredClone(session)) // 验证和归一化不修改请求对象
  const identities = new Set()                                      // 会话身份必须唯一，避免磁盘键互相覆盖
  for (const session of normalized) {
    if (!session?.id || !(session.workspaceId || session.workspaceID)) return { ok: false, status: 400, error: 'invalid session backup' } // 每个会话必须有身份和工作区归属
    normalizeSession(session, false)                           // 补齐字段但不提前创建事件状态
    if (identities.has(session.id)) return { ok: false, status: 400, error: 'duplicate session ID' } // 重复 ID 会丢失一条会话
    if (!workspaceIDs.has(session.workspaceID)) return { ok: false, status: 400, error: 'session references unknown workspace' } // 禁止导入孤立会话
    identities.add(session.id)
  }
  return { ok: true, sessions: normalized }
}


// --- 替换全部会话 ---
async function replaceAll(sessions) {
  const validated = validateAll(sessions)                         // 在删除现有磁盘记录前完成全部验证
  if (!validated.ok) return validated                             // 无效数据不产生任何副作用
  const normalized = validated.sessions                           // 使用独立归一化候选值

  await Promise.all([...sessionStore.writes.values()].map((write) => write.catch(() => {}))) // 等待旧会话写入完成
  const savedIDs = await sessionStore.storage.getKeys()         // 枚举磁盘旧会话
  await Promise.all(savedIDs.map((sessionID) => sessionStore.storage.removeItem(sessionID))) // 先清空旧持久化记录
  sessionStore.items.clear()                                    // 清空运行时会话目录
  for (const session of normalized) {
    sessionStore.items.set(session.id, session)                 // 按备份身份恢复运行时数据
    initialize(session.id)                                      // 数据正式进入目录后才建立事件状态
    await persist(session)                                      // 逐个写回完整会话
  }
  return { ok: true, sessions: normalized.length }              // 反馈恢复数量
}


function initialize(sessionID) {
  if (!store.events.bySession.has(sessionID)) store.events.bySession.set(sessionID, [])
  if (!store.events.listeners.has(sessionID)) store.events.listeners.set(sessionID, new Set())
  if (!store.events.nextID.has(sessionID)) store.events.nextID.set(sessionID, 1)
}
function emit(sessionID, name, data) {
  initialize(sessionID)
  const event = { id: store.events.nextID.get(sessionID), name, data: structuredClone(data), createdAt: Date.now() }
  store.events.nextID.set(sessionID, event.id + 1)
  const history = store.events.bySession.get(sessionID); history.push(event)
  if (history.length > 1000) history.splice(0, history.length - 1000)
  for (const listener of store.events.listeners.get(sessionID)) listener(event)
  return structuredClone(event)
}
function subscribe(sessionID, afterID = 0) {
  initialize(sessionID); let remove = () => {}
  return new ReadableStream({ start(writer) { const send = (event) => writer.enqueue(SSE.encode(event.name, event.data, event.id)); store.events.bySession.get(sessionID).filter((event) => event.id > afterID).forEach(send); store.events.listeners.get(sessionID).add(send); remove = () => store.events.listeners.get(sessionID)?.delete(send) }, cancel() { remove() } })
}
function removeEvents(sessionID) { store.events.bySession.delete(sessionID); store.events.listeners.delete(sessionID); store.events.nextID.delete(sessionID) }
function resetRuns() { store.runs.items.clear(); store.runs.bySession.clear() }
function getRun(id) { return store.runs.items.get(id) ?? null }
function isSessionRunning(sessionID) { const run = getRun(store.runs.bySession.get(sessionID)); return Boolean(run && ['queued', 'running', 'waiting_approval'].includes(run.status)) }
function markWaitingApproval(id) { const run = getRun(id); if (run?.status === 'running') run.status = 'waiting_approval'; return run }
function resume(id) { const run = getRun(id); if (run?.status === 'waiting_approval') run.status = 'running'; return run }
function publicRun(run) { const { abortController, ...value } = run; return structuredClone(value) }
function createRun({ sessionID, model, input }) {
  if (isSessionRunning(sessionID)) throw new Error('session is running')
  const modelSnapshot = Agent.resolve(model)
  const run = { id: `run_${nanoid(10)}`, sessionID, ...modelSnapshot, input, status: 'running', result: null, error: '', createdAt: Date.now(), startedAt: Date.now(), finishedAt: null, abortController: new AbortController() }
  store.runs.items.set(run.id, run); store.runs.bySession.set(sessionID, run.id); return run
}
async function runSession(run, sessionID, content, files) {
  const session = getMutable(sessionID); session.status = 'running'; session.modelMessages.push({ role: 'user', content }); session.messages.push({ id: `msg_${crypto.randomUUID()}`, role: 'user', content, contentBlocks: [{ type: 'text', text: { text: content } }], files, checkpoint: null, rolledBack: false, createdAt: Date.now() }); await persist(session)
  try {
    const result = streamText({ model: Config.createModel(run.provider, run.model), system: run.systemPrompt, messages: session.modelMessages, abortSignal: run.abortController.signal, providerOptions: Config.getProviderOptionsFor(run.provider, `${sessionID}:${run.id}`), ...Config.getGenerationOptionsFor(run.provider, run.model) })
    let text = ''; for await (const part of result.fullStream) { if (part.type === 'text-delta') { text += part.text; emit(sessionID, part.type, part) } }
    session.modelMessages.push(...(await result.response).messages); session.messages.push({ id: `msg_${crypto.randomUUID()}`, role: 'assistant', content: text, contentBlocks: [{ type: 'text', text: { text } }], checkpoint: null, rolledBack: false, createdAt: Date.now() }); await persist(session)
    run.status = 'completed'; run.result = { sessionID }; run.finishedAt = Date.now(); emit(sessionID, 'finish', { ok: true, sessionID, runID: run.id })
  } catch (error) { run.status = run.abortController.signal.aborted ? 'cancelled' : 'failed'; run.error = String(error); run.finishedAt = Date.now(); emit(sessionID, run.status === 'cancelled' ? 'finish' : 'error', run.status === 'cancelled' ? { ok: false, cancelled: true, sessionID, runID: run.id } : { message: String(error) }) }
  finally { const current = getMutable(sessionID); if (current) { current.status = 'idle'; await persist(current).catch(() => {}) } }
}
function sendSession(request) {
  const session = get(request.sessionId); if (!session) return { ok: false, status: 404, error: 'session not found' }; if (isSessionRunning(session.id)) return { ok: false, status: 409, error: 'session is running' }
  const run = createRun({ sessionID: session.id, model: session.model || Config.get().activeModel, input: request.content }); emit(session.id, 'run-created', { runID: run.id }); void runSession(run, session.id, request.content, (request.files || []).map(({ content, ...file }) => file)); return { ok: true, sessionId: session.id, run: publicRun(run) }
}
function stop(sessionID) { const run = getRun(store.runs.bySession.get(sessionID)); if (!run || !isSessionRunning(sessionID)) return { ok: false, status: 404, error: 'session is not running' }; run.abortController.abort('stopped by user'); return { ok: true } }

export const Session = { load, create, update, rename, updateTasks, list, get, getMutable, persist, remove, removeSafely, rollback, rollbackMessage, undoRollback, commitRollback, normalizeMessage, exportAll, validateAll, replaceAll, initialize, emit, subscribe, resetRuns, isSessionRunning, markWaitingApproval, resume, sendSession, stop } // 导出会话、事件和执行动作
