/*
会话事件指令：为每个会话保存有界事件历史，并向所有 SSE 订阅者广播。
事件 ID 在单个会话内严格递增，客户端可用 Last-Event-ID 恢复断线期间的事件。
调用示例：Event.emit('ses_1', 'status', { status: 'running' })、Event.subscribe('ses_1', 12)。
*/
import { store } from '../store.js'                     // 引入事件历史和订阅者状态根

const encoder = new TextEncoder()                       // 将标准 SSE 帧转换为网络字节
const maximumHistory = 1000                             // 每个会话保留最近一千个事件防止内存无限增长


// --- 初始化会话事件状态 ---
function initialize(sessionID) {
  if (!store.events.bySession.has(sessionID)) store.events.bySession.set(sessionID, []) // 新会话从空事件历史开始
  if (!store.events.listeners.has(sessionID)) store.events.listeners.set(sessionID, new Set()) // 新会话建立独立订阅集合
  if (!store.events.nextID.has(sessionID)) store.events.nextID.set(sessionID, 1) // 首个事件从 ID 1 开始
}


// --- 广播一个会话事件 ---
function emit(sessionID, name, data) {
  initialize(sessionID)                                  // 确保恢复的旧会话也可立即发事件
  const id = store.events.nextID.get(sessionID)          // 读取本会话下一个严格递增 ID
  const event = { id, name, data: structuredClone(data), createdAt: Date.now() } // 保存不可受调用方修改的事件快照
  store.events.nextID.set(sessionID, id + 1)             // 在通知订阅者前预留后续 ID

  const history = store.events.bySession.get(sessionID)  // 读取当前会话有序历史
  history.push(event)                                    // 新事件按产生顺序追加
  if (history.length > maximumHistory) history.splice(0, history.length - maximumHistory) // 只淘汰最旧事件
  for (const listener of store.events.listeners.get(sessionID)) listener(event) // 同步交给每个网络订阅者编码
  return structuredClone(event)                         // 反馈事件身份供指令测试和日志使用
}


// --- 订阅会话事件流 ---
function subscribe(sessionID, afterID = 0, options = {}) {
  initialize(sessionID)                                  // 首次订阅空会话时建立事件容器
  let removeListener = () => {}                          // 流关闭前提供统一清理动作
  const stream = new ReadableStream({
    start(streamWriter) {
      const send = (event) => streamWriter.enqueue(encoder.encode(format(event))) // 每个业务事件编码成完整 SSE 帧
      const history = store.events.bySession.get(sessionID)                       // 读取可用于断线恢复的有序历史
      history.filter((event) => event.id > afterID).forEach(send)                  // 只重放客户端尚未确认的事件
      store.events.listeners.get(sessionID).add(send)                              // 重放完成后订阅未来事件，保持顺序

      const closeOnFinish = (event) => {
        send(event)                                                                 // 兼容流先写入终态事件
        if (!['finish', 'error'].includes(event.name)) return                       // 普通事件继续保持连接
        removeListener()                                                            // 终态流立即移除两个监听器
        streamWriter.close()                                                        // 旧 `/chat/send` 在 Run 结束后关闭
      }
      if (options.closeOnFinish) {
        store.events.listeners.get(sessionID).delete(send)                          // 兼容流改用带关闭行为的监听器
        store.events.listeners.get(sessionID).add(closeOnFinish)                    // 后续事件由关闭监听器接收
      }
      removeListener = () => {
        store.events.listeners.get(sessionID)?.delete(send)                         // 移除普通持续订阅
        store.events.listeners.get(sessionID)?.delete(closeOnFinish)                // 移除兼容终态订阅
      }
    },
    cancel() { removeListener() },                          // 浏览器断开只移除监听，不停止后台 Run
  })
  return stream                                            // 由 HTTP 响应层添加 SSE 头
}


// --- 编码标准 SSE 帧 ---
function format(event) {
  const data = JSON.stringify(event.data, (_, value) => typeof value === 'bigint' ? Number(value) : value) // BigInt token 数转换为 JSON 数值
  return `id: ${event.id}\nevent: ${event.name}\ndata: ${data}\n\n` // 同时携带递增 ID、事件名和 JSON 数据
}


// --- 清除会话事件状态 ---
function remove(sessionID) {
  store.events.bySession.delete(sessionID)               // 删除不再可访问的历史事件
  store.events.listeners.delete(sessionID)               // 删除理论上已关闭的订阅集合
  store.events.nextID.delete(sessionID)                   // 删除该会话递增计数器
}


export const Event = { initialize, emit, subscribe, remove } // 暴露事件生命周期和订阅动作
