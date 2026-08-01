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
  workspaceStore.items.set(workspace.id, workspace)       // 先更新内存目录供随后会话使用
  await persist()                                         // 写盘完成后才反馈创建成功
  return { ok: true, workspace: structuredClone(workspace) } // 返回副本阻止入口直接修改状态
}


// --- 修改工作区定义 ---
async function update(workspaceID, changes = {}) {
  const workspace = workspaceStore.items.get(workspaceID) // 根据稳定 ID 读取目标工作区
  if (!workspace) return { ok: false, status: 404, error: 'workspace not found' } // 不允许通过修改动作隐式创建

  if ('name' in changes) {
    const name = typeof changes.name === 'string' ? changes.name.trim() : '' // 清理用户提供的展示名称
    if (!name) return { ok: false, status: 400, error: 'workspace name must not be empty' } // 空名称不能用于主页列表
    workspace.name = name                                   // 保存通过验证的展示名称
  }
  if ('path' in changes) {
    const path = typeof changes.path === 'string' ? changes.path.trim() : '' // 清理用户提供的新目录
    if (!path) return { ok: false, status: 400, error: 'workspace path must not be empty' } // 空目录不能成为执行边界
    workspace.path = resolve(path)                         // 保存稳定绝对路径
  }
  workspace.updatedAt = Date.now()                         // 记录设置最近修改时间
  await persist()                                         // 修改完成后同步独立工作区文件
  return { ok: true, workspace: structuredClone(workspace) } // 反馈最新持久化定义
}


// --- 移除工作区定义 ---
async function remove(workspaceID) {
  if (!workspaceStore.items.has(workspaceID)) return { ok: false, status: 404, error: 'workspace not found' } // 不存在时反馈明确资源错误
  const hasSessions = [...store.sessions.items.values()].some((session) => session.workspaceID === workspaceID) // 检查是否仍有会话引用
  if (hasSessions) return { ok: false, status: 409, error: 'workspace still has sessions' } // 防止产生无法归类的会话

  workspaceStore.items.delete(workspaceID)               // 只移除列表定义，不触碰用户本地目录
  await persist()                                         // 将移除结果同步到 workspace.json
  return { ok: true }                                     // 反馈列表定义已经删除
}


// --- 列出工作区定义 ---
function list() {
  return [...workspaceStore.items.values()].map((workspace) => structuredClone(workspace)) // 返回稳定顺序的独立副本
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


// --- 保存工作区目录 ---
async function persist() {
  const document = { workspaces: list() }                 // 独立文件只包含完整工作区数组
  await Bun.write(workspaceStore.filePath, `${JSON.stringify(document, null, 2)}\n`) // 稳定格式便于用户检查和备份
}


export const Workspace = { load, create, update, remove, list, get, getDefaultID } // 暴露工作区全部业务动作
