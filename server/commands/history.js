/*
历史指令：统一处理 checkpoint 回退、用户消息回退和撤销回退。
HTTP 入口只提交动作和目标；本指令负责运行冲突、参数要求与 Session 修改反馈。
调用示例：await History.change({ sessionId, action, checkpoint })。
*/
import { Run } from './run.js'         // 引入会话执行状态检查
import { Session } from './session.js' // 引入三类历史修改动作


// --- 执行一个历史动作 ---
async function change(request) {
  if (Run.isSessionRunning(request.sessionId)) return { ok: false, status: 409, error: 'session is running' } // 执行期间不能修改模型历史

  if (request.action === 'rollback-checkpoint') {
    if (!request.checkpoint) return { ok: false, status: 400, error: 'checkpoint is required' } // checkpoint 回退必须提供步骤
    return Session.rollback(request.sessionId, request.checkpoint) // 将有效目标交给 Session 原子修改
  }
  if (request.action === 'rollback-message') {
    if (!request.messageId) return { ok: false, status: 400, error: 'messageId is required' } // 消息回退必须提供身份
    return Session.rollbackMessage(request.sessionId, request.messageId) // 将有效目标交给 Session 原子修改
  }
  return Session.undoRollback(request.sessionId) // schema 保证剩余动作只能是撤销
}


// --- 回退到兼容 checkpoint 路径 ---
async function rollbackCheckpoint(sessionID, checkpoint) {
  return change({ sessionId: sessionID, action: 'rollback-checkpoint', checkpoint }) // 兼容入口复用相同冲突和原子修改规则
}


// --- 回退到兼容用户消息路径 ---
async function rollbackMessage(sessionID, messageId) {
  return change({ sessionId: sessionID, action: 'rollback-message', messageId }) // 兼容入口复用相同冲突和原子修改规则
}


// --- 撤销兼容回退路径 ---
async function undo(sessionID) {
  return change({ sessionId: sessionID, action: 'undo' }) // 兼容入口复用相同冲突和撤销规则
}


export const History = { change, rollbackCheckpoint, rollbackMessage, undo } // 暴露正式和兼容历史动作
