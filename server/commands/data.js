/*
数据指令：负责导出、导入和清理 Agent 的配置、工作区索引与完整会话。
工作区本地目录从不删除；每类数据仍由自己的主体指令验证和持久化。
调用示例：Data.exportBackup()、await Data.importBackup(document)、await Data.clear()。
*/
import { Config } from './config.js'                    // 引入配置读取和恢复指令
import { Session } from './session.js'                  // 引入完整会话备份指令
import { Workspace } from './workspace.js'              // 引入工作区目录备份指令


// --- 导出完整备份 ---
function exportBackup() {
  return {
    format: 'agent-backup',                              // 固定格式用于导入验证
    version: 1,                                          // 备份结构版本
    exportedAt: Date.now(),                              // 记录生成时间
    config: Config.get(),                                // 包含可恢复的运行配置和 MCP 定义
    workspaces: Workspace.list(),                        // 只导出工作区索引，不复制目录内容
    sessions: Session.exportAll(),                       // 导出完整展示和模型历史
  }
}


// --- 导入完整备份 ---
async function importBackup(document) {
  if (document?.format !== 'agent-backup' || document.version !== 1) return { ok: false, status: 400, error: 'invalid backup format' } // 拒绝未知文件
  if (!document.config || !Array.isArray(document.workspaces) || !Array.isArray(document.sessions)) return { ok: false, status: 400, error: 'backup is incomplete' } // 三类数据必须齐全

  const workspaceValidation = Workspace.validateAll(document.workspaces)  // 修改任何状态前验证完整工作区候选值
  if (!workspaceValidation.ok) return workspaceValidation                  // 工作区错误保持当前数据不变
  const workspaceIDs = new Set(workspaceValidation.workspaces.map((workspace) => workspace.id)) // 建立会话归属白名单
  const sessionValidation = Session.validateAll(document.sessions, workspaceIDs) // 跨领域验证所有会话引用
  if (!sessionValidation.ok) return sessionValidation                      // 孤立或重复会话不能部分覆盖工作区

  const workspaceResult = await Workspace.replaceAll(workspaceValidation.workspaces) // 全部验证后才开始恢复工作区
  if (!workspaceResult.ok) return workspaceResult                        // 工作区验证失败时停止导入
  const sessionResult = await Session.replaceAll(sessionValidation.sessions) // 再恢复已验证的完整会话
  if (!sessionResult.ok) return sessionResult                            // 会话验证失败时反馈原因
  await Config.update(document.config)                                   // 最后保存配置并保留脱敏恢复规则
  return { ok: true, workspaces: document.workspaces.length, sessions: document.sessions.length } // 反馈恢复统计
}


// --- 清理索引与会话 ---
async function clear() {
  await Session.replaceAll([])                         // 删除全部会话内存和磁盘记录
  await Workspace.replaceAll([])                       // 删除工作区索引但不触碰真实目录
  return { ok: true }                                  // 反馈数据清理完成
}


export const Data = { exportBackup, importBackup, clear } // 暴露三个数据管理动作
