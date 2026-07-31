/*
会话指令集：负责会话的创建、查询、删除、持久化、回滚与撤销。
所有业务修改先落到 sessionStore.items，再通过 unstorage 同步到真实磁盘。
调用示例：await Session.create()、await Session.rollback('ses_xxx', 2)。
*/
import { createStorage } from 'unstorage'             // 引入统一键值存储能力
import fsDriver from 'unstorage/drivers/fs'           // 引入真实文件系统存储驱动
import { nanoid } from 'nanoid'                       // 引入紧凑唯一 ID 生成能力
import { store } from '../store.js'                    // 引入服务端唯一状态根
import { Config } from './config.js'                   // 引入默认 Agent 选择

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
async function create(agentID) {
  const now = Date.now()                              // 创建和更新时间从同一个时刻开始
  const session = {                                   // 显式定义持久化会话的全部字段
    id: `ses_${nanoid(10)}`,                          // 会话唯一标识，用作 API 和磁盘键
    agentID: agentID || Config.get().defaultAgentId || 'default', // 会话默认 Agent，后续消息可显式校验
    title: '',                                        // 首条消息后由模型异步生成标题
    titleSource: 'generated',                         // 标记标题归属，异步生成不能覆盖用户重命名
    createdAt: now,                                   // 会话创建时间，Unix 毫秒
    updatedAt: now,                                   // 最近一次消息或回滚修改时间
    tasks: [],                                        // 当前会话的持久化任务清单
    taskRevision: 0,                                  // 每次任务修改递增，供客户端检测并发覆盖
    messages: [],                                     // 完整用户、助手与工具消息历史
    rollbackCache: null,                              // 最近一次回滚截断的消息，供撤销使用
    modelMessages: [],                                // AI SDK 标准历史与展示历史同步回退
  }
  sessionStore.items.set(session.id, session)         // 将新会话加入运行时映射
  await persist(session)                              // 创建成功前保证会话已经写盘
  return structuredClone(session)                    // 返回副本，避免入口直接改状态
}


// --- 重命名会话 ---
async function rename(sessionID, title) {
  const session = getMutable(sessionID)               // 从运行时状态读取目标会话
  if (!session) return { ok: false, status: 404, error: 'session not found' } // 不存在时反馈明确资源错误

  const nextTitle = typeof title === 'string' ? title.trim() : '' // 统一去除用户输入首尾空白
  if (!nextTitle) return { ok: false, status: 400, error: 'title must not be empty' } // 空标题无法用于会话列表
  if (nextTitle.length > 100) return { ok: false, status: 400, error: 'title must be at most 100 characters' } // 限制持久化和界面展示长度

  session.title = nextTitle                           // 保存通过验证的用户标题
  session.titleSource = 'user'                        // 阻止稍后完成的模型标题覆盖它
  await persist(session)                              // 写盘完成后才反馈重命名成功
  return { ok: true, title: nextTitle, titleSource: session.titleSource } // 返回客户端需要更新的字段
}


// --- 更新会话任务清单 ---
async function updateTasks(sessionID, tasks, expectedRevision) {
  const session = getMutable(sessionID)               // 从运行时状态读取目标会话
  if (!session) return { ok: false, status: 404, error: 'session not found' } // 不存在时不能创建游离任务
  if (expectedRevision !== undefined && expectedRevision !== session.taskRevision) return { ok: false, status: 409, error: 'task revision conflict', taskRevision: session.taskRevision } // 旧客户端不能覆盖较新清单

  const error = validateTasks(tasks)                  // 在修改共享状态前完整验证任务结构
  if (error) return { ok: false, status: 400, error } // 无效任务保持原清单和修订号不变

  session.tasks = structuredClone(tasks)              // 保存副本，避免工具输入随后修改共享状态
  session.taskRevision += 1                           // 每次成功替换都产生新的并发版本
  await persist(session)                              // 任务与修订号作为一个会话记录原子写盘
  return { ok: true, tasks: structuredClone(session.tasks), taskRevision: session.taskRevision } // 反馈最新持久化状态
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
function list() {
  return [...sessionStore.items.values()]             // 从运行时映射读取全部会话
    .sort((left, right) => right.updatedAt - left.updatedAt) // 最近更新的会话优先展示
    .map(({ id, title, agentID, createdAt, updatedAt, messages }) => ({ // API 列表不泄漏完整消息
      id, title, agentID, createdAt, updatedAt, messageCount: messages.length, // 同时反馈会话使用的 Agent
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

  sessionStore.items.delete(sessionID)                // 先移除运行时数据，阻止删除期间出现新的正常修改
  await sessionStore.writes.get(sessionID)?.catch(() => {}) // 等待较早保存结束，避免删除后旧写入重建文件
  await sessionStore.storage.removeItem(sessionID)    // 再移除对应磁盘记录
  return { ok: true }                                 // 向 HTTP 入口反馈删除完成
}


// --- 回滚到工具步骤 ---
async function rollback(sessionID, step) {
  const session = getMutable(sessionID)               // 读取需要截断的真实会话对象
  if (!session) return { ok: false, error: 'session not found' } // 会话不存在时拒绝回滚
  restoreRollbackCache(session)                       // 已暂存时先恢复完整历史，允许移动回退边界

  let lastToolIndex = -1                              // 默认表示没有找到目标存档点
  session.messages.forEach((message, index) => {      // 查找并行工具中目标步骤的最后一条
    if (message.role === 'tool' && message.step === step) lastToolIndex = index // 同步骤工具应整体保留
  })
  if (lastToolIndex < 0) return { ok: false, error: 'checkpoint not found' } // 无目标步骤时保持数据不变

  const target = session.messages[lastToolIndex]      // 保存目标工具供模型边界定位
  const modelBoundary = findToolModelBoundary(session.modelMessages, target.toolCallId) // 找到模型工具结果之后的位置
  stageRollback(session, lastToolIndex + 1, modelBoundary, { type: 'checkpoint', step }) // 两套历史同步暂存
  await persist(session)                              // 回滚结果与缓存一并写盘
  return { ok: true, remainingMessages: session.messages.length } // 反馈当前剩余消息数
}


// --- 回滚到用户消息并准备重新发送 ---
async function rollbackMessage(sessionID, messageID) {
  const session = getMutable(sessionID)               // 读取目标会话的真实历史
  if (!session) return { ok: false, error: 'session not found' } // 不存在时拒绝回退
  restoreRollbackCache(session)                       // 支持从当前暂存状态移动到另一条用户消息

  const messageIndex = session.messages.findIndex((item) => item.id === messageID && item.role === 'user') // 定位稳定用户消息
  if (messageIndex < 0) return { ok: false, error: 'user message not found' } // 只能回退到真实用户轮次

  const target = session.messages[messageIndex]       // 保存原文供前端恢复输入框
  const modelBoundary = findUserModelBoundary(session, messageIndex) // 找到该用户消息进入模型历史前的位置
  stageRollback(session, messageIndex, modelBoundary, { type: 'message', messageID, content: target.content }) // 暂存目标消息及后续历史
  await persist(session)                              // 回退边界和可撤销内容一起持久化
  return { ok: true, remainingMessages: session.messages.length, content: target.content } // 反馈可重新编辑的原文
}


// --- 撤销最近回滚 ---
async function undoRollback(sessionID) {
  const session = getMutable(sessionID)               // 读取包含回滚缓存的真实会话对象
  if (!session) return { ok: false, error: 'session not found' } // 会话不存在时拒绝操作
  if (!session.rollbackCache) return { ok: false, error: 'no rollback to undo' } // 没有缓存时不能恢复

  const restoredMessages = Array.isArray(session.rollbackCache) ? session.rollbackCache.length : session.rollbackCache.messages.length // 兼容旧数组缓存
  restoreRollbackCache(session)                       // 按原顺序恢复展示和模型历史
  await persist(session)                              // 恢复后的完整历史真实写盘
  return { ok: true, restoredMessages }               // 反馈恢复的消息数量
}


// --- 提交暂存回退 ---
function commitRollback(session) {
  session.rollbackCache = null                        // 新消息发送后丢弃暂存历史，正式形成分支
}


// --- 统一旧会话结构 ---
function normalizeSession(session) {
  session.agentID ??= Config.get().defaultAgentId || 'default' // 旧会话补齐默认 Agent
  session.title ??= ''                                // 旧会话缺少标题时保持可生成状态
  session.titleSource ??= 'generated'                 // 旧标题视为模型生成，后续用户重命名会明确接管
  session.tasks ??= []                                // 旧会话补齐空任务清单
  session.taskRevision ??= 0                          // 旧任务清单从初始修订开始
  session.messages ??= []                             // 旧空会话补齐展示历史
  session.modelMessages ??= []                        // 旧会话缺少模型历史时保持可继续发送
  session.messages.forEach((message) => { message.id ??= `msg_${nanoid(10)}` }) // 每条消息获得稳定 UI 动作标识
  session.rollbackCache ??= null                      // 旧文件补齐可撤销状态
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


export const Session = { load, create, rename, updateTasks, list, get, getMutable, persist, remove, rollback, rollbackMessage, undoRollback, commitRollback } // 导出会话业务动作
