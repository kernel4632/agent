/*
工具指令集：扫描内置与用户目录，注册模型工具，并管理热重载监听。
每个工具文件的命名导出只要具备 description 和 execute 就会成为一个可调用工具。
调用示例：await Tool.load(['./tools/built-in', './tools/custom'])、Tool.list()。
*/
import { readdir } from 'node:fs/promises'                 // 引入目录扫描能力
import { join, resolve } from 'node:path'                  // 引入跨平台路径拼接能力
import { pathToFileURL } from 'node:url'                  // 引入动态导入所需的文件 URL 转换能力
import chokidar from 'chokidar'                            // 引入工具文件热重载监听能力
import { toolStore } from '../store/tools.js'              // 引入唯一工具注册表


// --- 扫描一个目录中的工具文件 ---
async function readFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true }) // 读取工具目录的直接子项
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => join(directory, entry.name)) // 只加载 JS 工具文件
  } catch (error) {
    if (error.code === 'ENOENT') return []                         // 可选自定义目录不存在时按空目录处理
    throw error                                                     // 其他磁盘错误必须反馈给启动流程
  }
}


// --- 加载一个工具文件 ---
async function loadFile(filePath) {
  const absolutePath = resolve(filePath)                           // 统一为绝对路径，避免监听事件路径不一致
  const previous = [...toolStore.items.entries()].filter(([, item]) => item.filePath === absolutePath).map(([name]) => name) // 找到该文件旧注册项
  previous.forEach((name) => toolStore.items.delete(name))          // 修改前移除旧导出，防止删除的工具残留

  const moduleURL = `${pathToFileURL(absolutePath).href}?updated=${Date.now()}` // 查询参数强制重新加载模块缓存
  const module = await import(moduleURL)                             // 执行用户工具文件并读取命名导出
  for (const [name, definition] of Object.entries(module)) {         // 将每个符合协议的导出注册为独立工具
    if (!definition?.description || typeof definition.execute !== 'function') continue // 忽略普通常量和默认导出
    toolStore.items.set(name, { ...definition, name, filePath: absolutePath, source: absolutePath.includes(`${join('tools', 'custom')}${process.platform === 'win32' ? '\\' : '/'}`) ? 'custom' : 'built-in' }) // 保存完整来源信息供 API 展示
  }
}


// --- 全量加载工具目录 ---
async function load(directories) {
  toolStore.directories = directories.map((directory) => resolve(directory)) // 保存后续 reload 使用的目录清单
  const files = (await Promise.all(toolStore.directories.map(readFiles))).flat() // 并行扫描内置和自定义目录
  const errors = []                                                   // 单文件错误不阻断其他工具加载
  for (const filePath of files) {
    try { await loadFile(filePath) }                                  // 逐文件注册，保证错误能关联具体文件
    catch (error) { errors.push({ file: filePath, error: String(error) }) } // 收集加载错误交给 API 反馈
  }
  return { ok: true, loaded: toolStore.items.size, files: files.length, errors } // 返回本次扫描完整结果
}


// --- 开始工具热重载 ---
async function watch() {
  if (toolStore.watcher) return                                    // 防止应用重复创建监听器
  const patterns = toolStore.directories.map((directory) => join(directory, '*.js')) // 只监听工具文件而非整个用户目录
  toolStore.watcher = chokidar.watch(patterns, { ignoreInitial: true }) // 启动新增、修改和删除事件监听
  toolStore.watcher.on('add', (filePath) => loadFile(filePath).catch(() => {})) // 新文件加入注册表，错误不影响服务
  toolStore.watcher.on('change', (filePath) => loadFile(filePath).catch(() => {})) // 文件修改后替换旧工具定义
  toolStore.watcher.on('unlink', (filePath) => {                    // 文件删除后清理它注册的全部工具
    const absolutePath = resolve(filePath)
    for (const [name, item] of toolStore.items) if (item.filePath === absolutePath) toolStore.items.delete(name) // 只移除来源相同的工具
  })
}


// --- 关闭工具监听 ---
async function close() {
  if (!toolStore.watcher) return                                     // 尚未监听时无需执行清理
  await toolStore.watcher.close()                                   // 释放真实文件系统监听资源
  toolStore.watcher = null                                           // 允许下一次启动重新创建监听器
}


// --- 列出模型可用工具 ---
function list() {
  return [...toolStore.items.values()].map(({ name, description, parameters, source }) => ({ name, description, parameters, source })) // 隐藏执行函数与磁盘绝对路径
}


export const Tool = { load, watch, close, list }                     // 导出工具加载、监听和查询动作
