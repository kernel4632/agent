/*
Agent Server 运行时：解析数据目录，按依赖顺序初始化持久化状态和外部能力，并集中释放资源。
HTTP 层只消费这里返回的目录上下文，不参与文件系统、进程或连接生命周期。
调用示例：const runtime = await Runtime.start({ dataDirectory }); await runtime.close()。
*/
import { mkdir } from 'node:fs/promises'            // 引入创建会话和自定义工具目录的能力
import { join, resolve } from 'node:path'            // 引入跨平台目录定位能力
import { Config } from './commands/config.js'         // 引入配置与能力生命周期指令
import { Session } from './commands/session.js'       // 引入会话与 Run 生命周期指令
import { Skill } from './commands/skills.js'         // 引入 Skill 扫描指令
import { Workspace } from './commands/workspace.js'  // 引入工作区目录恢复指令
import { store } from './store.js'                   // 引入服务端唯一状态根


// --- 启动全部服务端资源 ---
async function start(options = {}) {
  const dataDirectory = resolve(options.dataDirectory ?? process.env.AGENT_DATA_DIR ?? join(process.env.USERPROFILE ?? '.', '.agent')) // 确定用户数据根目录
  const sessionsDirectory = join(dataDirectory, 'sessions')       // 会话使用独立持久化目录
  const toolsDirectory = join(dataDirectory, 'tools')             // 用户工具位于数据目录内部
  const customToolsDirectory = join(toolsDirectory, 'custom')     // 模型和用户只写入自定义工具目录
  const configPath = resolve(options.configPath ?? join(dataDirectory, 'config.json')) // 配置默认位于数据根目录
  const workspacePath = resolve(options.workspacePath ?? join(dataDirectory, 'workspace.json')) // 工作区目录使用独立设计文件
  const mcpPath = resolve(options.mcpPath ?? join(dataDirectory, 'mcp.json')) // MCP 定义使用独立设计文件
  const builtInToolsDirectory = resolve(options.builtInToolsDirectory ?? join(import.meta.dir, 'tools', 'built-in')) // 内置工具随服务代码分发
  const workspaceDirectory = resolve(options.workspaceDirectory ?? process.env.AGENT_WORKSPACE ?? join(import.meta.dir, '..')) // 项目 Skill 和 MCP 使用同一工作区

  try {
    await mkdir(customToolsDirectory, { recursive: true })          // 工具扫描前确保自定义目录存在
    await mkdir(sessionsDirectory, { recursive: true })             // 会话恢复前确保持久化目录存在
    await Config.load(configPath, mcpPath)                          // 后续能力初始化依赖当前配置和独立 MCP 定义
    await Workspace.load(workspacePath, workspaceDirectory)         // 会话恢复前先建立可引用的工作区目录
    Session.resetRuns()                                               // 清除上一次进程遗留的不可恢复 Run
    await Session.load(sessionsDirectory)                           // 将磁盘会话恢复到运行时状态
    await Config.loadTools([builtInToolsDirectory, customToolsDirectory]) // 注册内置和用户工具
    await Config.watchTools()                                       // 启动自定义工具热重载
    await options.lifecycle?.afterTools?.({ dataDirectory, workspaceDirectory }) // 测试或宿主可在资源阶段注入可控失败

    store.capabilities.workspaceDirectory = workspaceDirectory     // 外部能力共享当前项目根目录
    store.capabilities.dataDirectory = dataDirectory               // Skill 扫描使用当前用户数据目录
    await Skill.reload()                                            // 先注册 Skill 元数据和按需加载工具
    await Config.reloadMCP()                                        // 最后连接配置声明的 MCP 服务

    return {
      directories: { builtInToolsDirectory, customToolsDirectory }, // HTTP 工具重载只需要这两个目录
      close,                                                        // 将统一关闭动作交给应用宿主
    }
  } catch (error) {
    await close().catch(() => {})                                   // 任一初始化阶段失败都释放已打开的监听器和外部进程
    throw error                                                      // 保留原始启动错误供宿主和测试定位
  }
}


// --- 关闭全部服务端资源 ---
async function close() {
  await Config.closeMCP()                                          // 释放 MCP 网络连接和子进程
  await Config.closeTools()                                        // 最后关闭工具目录监听器
}


export const Runtime = { start }                                  // 暴露唯一运行时启动入口
