/*
会话指令集：负责会话的创建、查询、删除、持久化、回滚与撤销。
所有业务修改先落到 sessionStore.items，再通过 unstorage 同步到真实磁盘。
调用示例：await Session.create()、await Session.rollback('ses_xxx', 2)。
*/
import { createStorage } from 'unstorage'             // 引入统一键值存储能力
import fsDriver from 'unstorage/drivers/fs'           // 引入真实文件系统存储驱动
import { nanoid } from 'nanoid'                       // 引入紧凑唯一 ID 生成能力
import { sessionStore } from '../store/sessions.js'   // 引入唯一会话状态


// --- 加载磁盘会话 ---
async function load(directory) {
  sessionStore.storage = createStorage({              // 将每个会话映射为目录内的 JSON 数据
    driver: fsDriver({ base: directory }),            // 使用当前应用数据目录，测试与用户数据相互隔离
  })
  sessionStore.items.clear()                          // 重载前清除旧运行时状态

  const sessionIDs = await sessionStore.storage.getKeys() // 枚举磁盘上已有的全部会话键
  for (const sessionID of sessionIDs) {               // 逐个恢复会话，保证服务重启后历史可用
    const session = await sessionStore.storage.getItem(sessionID) // 读取完整会话数据
    if (session?.id) sessionStore.items.set(sessionID, session)    // 忽略无效存储项，避免污染列表
  }
}


// --- 创建空会话 ---
async function create() {
  const now = Date.now()                              // 创建和更新时间从同一个时刻开始
  const session = {                                   // 显式定义持久化会话的全部字段
    id: `ses_${nanoid(10)}`,                          // 会话唯一标识，用作 API 和磁盘键
    title: '',                                        // 首条消息后由模型异步生成标题
    createdAt: now,                                   // 会话创建时间，Unix 毫秒
    updatedAt: now,                                   // 最近一次消息或回滚修改时间
    messages: [],                                     // 完整用户、助手与工具消息历史
    rollbackCache: null,                              // 最近一次回滚截断的消息，供撤销使用
  }
  sessionStore.items.set(session.id, session)         // 将新会话加入运行时映射
  await persist(session)                              // 创建成功前保证会话已经写盘
  return structuredClone(session)                    // 返回副本，避免入口直接改状态
}


// --- 列出会话摘要 ---
function list() {
  return [...sessionStore.items.values()]             // 从运行时映射读取全部会话
    .sort((left, right) => right.updatedAt - left.updatedAt) // 最近更新的会话优先展示
    .map(({ id, title, createdAt, updatedAt, messages }) => ({ // API 列表不泄漏完整消息
      id, title, createdAt, updatedAt, messageCount: messages.length, // 仅返回设计文档规定的摘要字段
    }))
}


// --- 获取完整会话 ---
function get(sessionID) {
  const session = sessionStore.items.get(sessionID)   // 根据路由参数读取目标会话
  if (!session) return null                            // 不存在时返回空值供入口转换为 404
  const visibleSession = structuredClone(session)     // 返回副本，防止入口直接修改状态
  delete visibleSession.modelMessages                 // 模型协议历史是内部数据，不属于会话 API 展示结构
  return visibleSession                                // 反馈 README 规定的完整用户可见会话
}


// --- 获取可修改会话引用 ---
function getMutable(sessionID) {
  return sessionStore.items.get(sessionID) ?? null    // 仅供 commands 内部显式修改会话数据
}


// --- 持久化会话 ---
async function persist(session) {
  session.updatedAt = Date.now()                      // 每次成功修改都刷新列表排序时间
  await sessionStore.storage.setItem(session.id, session) // 将完整结构真实写入文件系统
}


// --- 删除会话 ---
async function remove(sessionID) {
  if (!sessionStore.items.has(sessionID)) {           // 不存在的会话无法删除
    return { ok: false, error: 'session not found' }
  }

  sessionStore.items.delete(sessionID)                // 先移除运行时数据，立即停止后续访问
  await sessionStore.storage.removeItem(sessionID)    // 再移除对应磁盘记录
  return { ok: true }                                 // 向 HTTP 入口反馈删除完成
}


// --- 回滚到工具步骤 ---
async function rollback(sessionID, step) {
  const session = getMutable(sessionID)               // 读取需要截断的真实会话对象
  if (!session) return { ok: false, error: 'session not found' } // 会话不存在时拒绝回滚

  let lastToolIndex = -1                              // 默认表示没有找到目标存档点
  session.messages.forEach((message, index) => {      // 查找并行工具中目标步骤的最后一条
    if (message.role === 'tool' && message.step === step) lastToolIndex = index // 同步骤工具应整体保留
  })
  if (lastToolIndex < 0) return { ok: false, error: 'checkpoint not found' } // 无目标步骤时保持数据不变

  session.rollbackCache = session.messages.splice(lastToolIndex + 1) // 截断内容暂存供一次撤销
  await persist(session)                              // 回滚结果与缓存一并写盘
  return { ok: true, remainingMessages: session.messages.length } // 反馈当前剩余消息数
}


// --- 撤销最近回滚 ---
async function undoRollback(sessionID) {
  const session = getMutable(sessionID)               // 读取包含回滚缓存的真实会话对象
  if (!session) return { ok: false, error: 'session not found' } // 会话不存在时拒绝操作
  if (!session.rollbackCache) return { ok: false, error: 'no rollback to undo' } // 没有缓存时不能恢复

  const restoredMessages = session.rollbackCache.length // 在清空缓存前记录恢复数量
  session.messages.push(...session.rollbackCache)     // 按原顺序恢复全部截断消息
  session.rollbackCache = null                        // 每次回滚只允许撤销一次
  await persist(session)                              // 恢复后的完整历史真实写盘
  return { ok: true, restoredMessages }               // 反馈恢复的消息数量
}


export const Session = { load, create, list, get, getMutable, persist, remove, rollback, undoRollback } // 导出会话业务动作
