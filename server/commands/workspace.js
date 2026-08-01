/*
工作区指令集：负责工作区目录的加载、增删改查和磁盘持久化。
会话摘要由 Session 指令提供，工作区文件只保存 id、path、name 和时间字段。
调用示例：await Workspace.load('C:/Users/me/.agent/workspace.json')、await Workspace.create('C:/project')。
*/
import { mkdir } from 'node:fs/promises'                 // 引入首次运行时创建数据目录的能力
import { basename, dirname, resolve } from 'node:path'   // 引入工作区路径归一化和名称提取能力
import { nanoid } from 'nanoid'                         // 引入紧凑唯一 ID 生成能力
import { store } from '../store.js'                     // 引入服务端唯一状态根

const workspaceStore = store.workspaces                 // 当前指令只修改工作区领域状态


// --- 加载工作区目录 ---
async function load(filePath, defaultPath) {
  workspaceStore.filePath = filePath                    // 后续全部保存复用同一文件位置
  workspaceStore.items.clear()                          // 重载前移除旧进程中的工作区定义
  await mkdir(dirname(filePath), { recursive: true })    // 首次运行时确保数据目录存在

  const file = Bun.file(filePath)                       // 定位独立 workspace.json 文件
  const saved = await file.exists() ? await file.json() : { workspaces: [] } // 文件缺失时从空列表开始
  for (const workspace of saved.workspaces ?? []) {
    if (!workspace?.id || !workspace?.path) continue    // 无身份或路径的损坏记录不能进入运行态
    workspaceStore.items.set(workspace.id, normalize(workspace)) // 旧记录补齐展示字段后恢复
  }

  if (workspaceStore.items.size === 0 && defaultPath) {
    const workspace = createValue(defaultPath, '当前项目') // 保证首次启动即可创建符合契约的会话
    workspaceStore.items.set(workspace.id, workspace)       // 默认项目作为正常工作区管理
    await persist()                                         // 默认定义立即写入独立文件
  }
  return list()                                             // 向 Runtime 反馈已恢复的工作区目录
}


// --- 创建工作区定义 ---
async function create(path, name) {
  if (typeof path !== 'string' || !path.trim()) return { ok: false, status: 400, error: 'workspace path must not be empty' } // 空路径无法绑定文件工具
  const normalizedPath = resolve(path.trim())             // 相对路径按服务进程目录变成稳定绝对路径
  const duplicate = [...workspaceStore.items.values()].find((item) => item.path.toLowerCase() === normalizedPath.toLowerCase()) // 同一路径只保留一个身份
  if (duplicate) return { ok: false, status: 409, error: 'workspace path already exists', workspaceID: duplicate.id } // 避免会话被重复工作区分割

  const workspace = createValue(normalizedPath, name)     // 构建完整持久化工作区记录
  await persist([...workspaceStore.items.values(), workspace]) // 候选目录先写盘，失败时当前 Store 保持不变
  workspaceStore.items.set(workspace.id, workspace)       // 持久化成功后提交运行时目录
  return { ok: true, workspace: structuredClone(workspace) } // 返回副本阻止入口直接修改状态
}


// --- 修改工作区定义 ---
async function update(workspaceID, changes = {}) {
  const workspace = workspaceStore.items.get(workspaceID) // 根据稳定 ID 读取目标工作区
  if (!workspace) return { ok: false, status: 404, error: 'workspace not found' } // 不允许通过修改动作隐式创建

  const candidate = structuredClone(workspace)             // 所有字段在独立候选值上验证和修改
  if ('name' in changes) {
    const name = typeof changes.name === 'string' ? changes.name.trim() : '' // 清理用户提供的展示名称
    if (!name) return { ok: false, status: 400, error: 'workspace name must not be empty' } // 空名称不能用于主页列表
    candidate.name = name                                   // 候选值保存通过验证的名称
  }
  if ('path' in changes) {
    const path = typeof changes.path === 'string' ? changes.path.trim() : '' // 清理用户提供的新目录
    if (!path) return { ok: false, status: 400, error: 'workspace path must not be empty' } // 空目录不能成为执行边界
    candidate.path = resolve(path)                         // 候选值保存稳定绝对路径
    const duplicate = [...workspaceStore.items.values()].find((item) => item.id !== workspaceID && item.path.toLowerCase() === candidate.path.toLowerCase()) // 修改路径也不能产生重复工作区
    if (duplicate) return { ok: false, status: 409, error: 'workspace path already exists', workspaceID: duplicate.id } // 冲突保持当前记录不变
  }
  candidate.updatedAt = Date.now()                         // 候选值记录设置最近修改时间
  const values = [...workspaceStore.items.values()].map((item) => item.id === workspaceID ? candidate : item) // 构造完整候选目录
  await persist(values)                                    // 完整目录写盘成功前不修改 Store
  workspaceStore.items.set(workspaceID, candidate)         // 持久化成功后一次提交候选值
  return { ok: true, workspace: structuredClone(candidate) } // 反馈最新持久化定义
}


// --- 移除工作区定义 ---
async function remove(workspaceID) {
  if (!workspaceStore.items.has(workspaceID)) return { ok: false, status: 404, error: 'workspace not found' } // 不存在时反馈明确资源错误
  const hasSessions = [...store.sessions.items.values()].some((session) => session.workspaceID === workspaceID) // 检查是否仍有会话引用
  if (hasSessions) return { ok: false, status: 409, error: 'workspace still has sessions' } // 防止产生无法归类的会话

  const values = [...workspaceStore.items.values()].filter((workspace) => workspace.id !== workspaceID) // 构造不含目标的候选目录
  await persist(values)                                    // 先保存候选目录，不触碰用户本地内容
  workspaceStore.items.delete(workspaceID)                 // 写盘成功后移除运行时定义
  return { ok: true }                                     // 反馈列表定义已经删除
}


// --- 列出工作区定义 ---
function list() {
  return [...workspaceStore.items.values()].map((workspace) => structuredClone(workspace)) // 返回稳定顺序的独立副本
}


// --- 列出工作区与下属会话摘要 ---
function listWithSessions() {
  const sessions = [...store.sessions.items.values()]                       // 一次读取当前完整会话目录
  return list().map((workspace) => ({
    ...workspace,                                                           // 保留工作区身份、路径和时间
    sessions: sessions.filter((session) => session.workspaceID === workspace.id).sort((left, right) => right.updatedAt - left.updatedAt).map((session) => ({ id: session.id, sessionId: session.id, workspaceID: session.workspaceID, workspaceId: session.workspaceID, title: session.title, model: session.model, status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt, lastActiveAt: session.lastActiveAt, messageCount: session.messages.length })), // 设计要求工作区直接包含 Session 摘要
  }))
}


// --- 读取一个工作区定义 ---
function get(workspaceID) {
  const workspace = workspaceStore.items.get(workspaceID) // 从运行时目录读取目标工作区
  return workspace ? structuredClone(workspace) : null     // 指令外只获得不可修改副本
}


// --- 读取默认工作区身份 ---
function getDefaultID() {
  return workspaceStore.items.keys().next().value ?? null  // 首个工作区作为兼容会话的默认归属
}


// --- 构建工作区记录 ---
function createValue(path, name) {
  const now = Date.now()                                  // 创建和更新时间共享同一基准
  const normalizedPath = resolve(path)                    // 所有记录保存绝对路径
  return {
    id: `wrk_${nanoid(10)}`,                              // 工作区唯一身份用于 API 和会话关联
    name: typeof name === 'string' && name.trim() ? name.trim() : basename(normalizedPath) || normalizedPath, // 默认使用目录名展示
    path: normalizedPath,                                 // Agent 工具工作的真实目录
    createdAt: now,                                       // Unix 毫秒创建时间
    updatedAt: now,                                       // Unix 毫秒最近修改时间
  }
}


// --- 统一旧工作区记录 ---
function normalize(workspace) {
  const path = resolve(workspace.path)                    // 旧相对路径升级为稳定绝对路径
  return {
    id: workspace.id,                                     // 保留会话已经引用的身份
    name: workspace.name || basename(path) || path,        // 缺失名称时使用目录名
    path,                                                  // 保存归一化后的绝对目录
    createdAt: workspace.createdAt ?? Date.now(),          // 旧记录补齐创建时间
    updatedAt: workspace.updatedAt ?? workspace.createdAt ?? Date.now(), // 旧记录补齐修改时间
  }
}


// --- 验证完整工作区备份 ---
function validateAll(workspaces) {
  if (!Array.isArray(workspaces)) return { ok: false, status: 400, error: 'workspaces must be an array' } // 备份必须提供完整数组
  const normalized = []                                      // 修改共享状态前先构建独立候选值
  const identities = new Set()                               // 工作区身份不能重复覆盖
  const paths = new Set()                                    // 同一路径不能在导入后分裂成多个工作区
  for (const workspace of workspaces) {
    if (!workspace?.id || !workspace?.path) return { ok: false, status: 400, error: 'invalid workspace backup' } // 每项必须保留身份和路径
    const value = normalize(workspace)                       // 统一旧备份字段和绝对路径
    const pathKey = value.path.toLowerCase()                 // Windows 和常见工作区语义按大小写不敏感检查
    if (identities.has(value.id)) return { ok: false, status: 400, error: 'duplicate workspace ID' } // 重复身份会覆盖数据
    if (paths.has(pathKey)) return { ok: false, status: 400, error: 'duplicate workspace path' } // 重复目录会产生歧义
    identities.add(value.id)
    paths.add(pathKey)
    normalized.push(value)
  }
  return { ok: true, workspaces: normalized }
}


// --- 保存工作区目录 ---
async function persist(workspaces = list()) {
  const document = { workspaces: structuredClone(workspaces) } // 独立文件只包含调用方确认的完整候选数组
  await Bun.write(workspaceStore.filePath, `${JSON.stringify(document, null, 2)}\n`) // 稳定格式便于用户检查和备份
}


// --- 替换完整工作区目录 ---
async function replaceAll(workspaces) {
  const validated = validateAll(workspaces)                  // 复用无副作用验证，导入可先检查全部领域
  if (!validated.ok) return validated                        // 无效备份保持当前状态不变
  const normalized = validated.workspaces                    // 使用已经归一化的独立候选值
  await persist(normalized)                                  // 候选目录先一次写入 workspace.json
  workspaceStore.items.clear()                              // 写盘成功后替换运行时目录
  normalized.forEach((workspace) => workspaceStore.items.set(workspace.id, workspace)) // 恢复备份顺序和身份
  return { ok: true, workspaces: list() }                   // 反馈最终持久化目录
}


export const Workspace = { load, create, update, remove, validateAll, replaceAll, list, listWithSessions, get, getDefaultID } // 暴露工作区全部业务动作
