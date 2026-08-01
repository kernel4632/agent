/*
Run 指令：记录一次 Agent 执行及其父子关系，负责并行登记、状态转换和取消传播。
Run 不拥有工具、MCP、LSP 或工作区；所有执行者继续共享服务端统一环境。
调用示例：const run = Run.create({ sessionID, agentID }); Run.cancel(run.id)。
*/
import { nanoid } from 'nanoid'                         // 引入 Run 唯一标识生成能力
import { Agent } from './agent.js'                      // 引入 Agent 快照解析指令
import { store } from '../store.js'                     // 引入 Run 状态树


// --- 清空进程重启后不可恢复的运行态 ---
function reset() {
  store.runs.items.clear()                              // 旧进程的 AbortController 已经失效
  store.runs.bySession.clear()                          // 清除旧会话索引
  store.runs.byParent.clear()                           // 清除旧父子索引
}


// --- 创建一个根 Run 或子 Run ---
function create({ sessionID, agentID, parentRunID = null, input = '' }) {
  const parent = parentRunID ? get(parentRunID) : null
  if (parentRunID && (!parent || parent.sessionID !== sessionID)) throw new Error('parent run does not belong to session') // 子 Run 不能跨会话
  if (parent && parent.depth >= 4) throw new Error('maximum child run depth reached') // 限制递归深度，避免模型无限派生自己
  const run = {
    id: `run_${nanoid(10)}`,                             // Run ID 供停止、审批和 SSE 归属使用
    sessionID,
    agentID: Agent.resolve(agentID).id,
    parentRunID,
    status: 'queued',                                   // 创建后等待 Chat 或子智能体执行
    input,
    result: null,
    error: '',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    depth: parent ? parent.depth + 1 : 0,
    abortController: new AbortController(),             // 每个 Run 独立取消，环境资源仍然共享
  }
  store.runs.items.set(run.id, run)                     // 先登记事实再开始异步执行
  const index = parentRunID ? store.runs.byParent : store.runs.bySession
  const key = parentRunID || sessionID
  if (!index.has(key)) index.set(key, new Set())
  index.get(key).add(run.id)                            // 建立父子或会话索引
  return run
}


// --- 读取一个 Run ---
function get(runID) {
  return store.runs.items.get(runID) ?? null             // 内部调用使用真实运行对象
}


// --- 列出会话全部 Run ---
function listForSession(sessionID) {
  return [...store.runs.items.values()]
    .filter((run) => run.sessionID === sessionID)
    .map(toPublicRun)                                   // API 只返回可序列化状态
}


// --- 判断会话是否存在活动 Run ---
function isSessionRunning(sessionID) {
  return [...store.runs.items.values()].some((run) => run.sessionID === sessionID && isRunning(run.id)) // 根 Run 和子 Run 任一活动都阻止历史修改
}


// --- 读取公开 Run 结果 ---
function getPublic(runID) {
  const run = get(runID)                                            // 读取内部运行记录
  return run ? { ok: true, run: toPublicRun(run) } : { ok: false, status: 404, error: 'run not found' } // 未知身份使用真实 404
}


// --- 安全取消一个 Run ---
function cancelPublic(runID) {
  if (!get(runID)) return { ok: false, status: 404, error: 'run not found' } // 未知 Run 不能抛出通用 500
  return { ok: true, run: cancel(runID) }                            // 反馈取消后的公开状态
}


// --- 标记 Run 开始执行 ---
function markRunning(runID) {
  const run = requireRun(runID)
  if (run.status !== 'queued') return run                 // 重复启动保持原状态
  run.status = 'running'
  run.startedAt = Date.now()
  return run
}


// --- 标记 Run 正在等待用户审批 ---
function markWaitingApproval(runID) {
  const run = requireRun(runID)                                      // 读取必须存在的执行事实
  if (run.status === 'running') run.status = 'waiting_approval'      // 只有执行中的 Run 能进入审批等待
  return run                                                        // 反馈当前状态供审批流程继续使用
}


// --- 审批完成后恢复 Run 执行 ---
function resume(runID) {
  const run = requireRun(runID)                                      // 读取必须存在的执行事实
  if (run.status === 'waiting_approval') run.status = 'running'      // 审批通过或拒绝都要结束等待态
  return run                                                        // 反馈恢复后的运行状态
}


// --- 完成一个 Run 并反馈结果 ---
function complete(runID, result = null) {
  return finish(runID, 'completed', result, '')
}


// --- 标记一个 Run 失败 ---
function fail(runID, error) {
  return finish(runID, 'failed', null, String(error?.message || error))
}


// --- 取消一个 Run 及其全部子 Run ---
function cancel(runID, reason = 'cancelled') {
  const run = requireRun(runID)
  run.abortController.abort(reason)                       // 先通知当前模型和工具等待
  for (const childID of store.runs.byParent.get(runID) || []) cancel(childID, reason) // 再向下传播取消
  if (!['completed', 'failed', 'cancelled'].includes(run.status)) {
    run.status = 'cancelled'
    run.error = reason
    run.finishedAt = Date.now()
  }
  return toPublicRun(run)
}


// --- 判断一个 Run 是否仍在执行 ---
function isRunning(runID) {
  const run = get(runID)
  return Boolean(run && ['queued', 'running', 'waiting_approval'].includes(run.status))
}


// --- 完成一次状态转换 ---
function finish(runID, status, result, error) {
  const run = requireRun(runID)
  if (['completed', 'failed', 'cancelled'].includes(run.status)) return run // 终态只允许第一次写入
  run.status = status
  run.result = result
  run.error = error
  run.finishedAt = Date.now()
  return run
}


// --- 确保目标 Run 存在 ---
function requireRun(runID) {
  const run = get(runID)
  if (!run) throw new Error(`run not found: ${runID}`)
  return run
}


// --- 删除运行时控制对象后返回公开状态 ---
function toPublicRun(run) {
  const { abortController, ...publicRun } = run
  return structuredClone(publicRun)
}


export const Run = { reset, create, get, getPublic, listForSession, isSessionRunning, markRunning, markWaitingApproval, resume, complete, fail, cancel, cancelPublic, isRunning, toPublicRun } // 暴露 Run 生命周期和查询指令
