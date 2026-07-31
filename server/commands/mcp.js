/*
MCP 指令集：按配置连接 stdio 或 Streamable HTTP 服务，并把远程工具注册到 Agent。
触发来自启动、配置重载或工具调用；连接状态只写运行仓库，远程结果沿现有工具链反馈。
调用示例：await MCP.reload()、MCP.list()、await MCP.close()。
*/
import { Client } from '@modelcontextprotocol/sdk/client/index.js'                // 引入官方 MCP 客户端握手与工具调用能力
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'  // 引入本地子进程 stdio 传输
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js' // 引入当前 HTTP 传输
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js' // 引入远程工具变化通知协议
import { Config } from './config.js'                                            // 引入最新 MCP 服务声明
import { capabilityStore } from '../store/capabilities.js'                      // 引入连接运行状态
import { toolStore } from '../store/tools.js'                                   // 引入 Agent 统一工具注册表


// --- 创建稳定的 Agent 工具名称 ---
function createToolName(serverName, remoteName) {
  const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, '_')                 // 清理模型工具协议不接受的服务字符
  const safeTool = remoteName.replace(/[^a-zA-Z0-9_-]/g, '_')                   // 清理远程工具名称中的命名空间字符
  return `mcp_${safeServer}_${safeTool}`                                         // 服务前缀防止多个 MCP 工具重名
}


// --- 移除一个 MCP 服务注册的工具 ---
function removeTools(serverName) {
  for (const [name, tool] of toolStore.items) {
    if (tool.kind === 'mcp' && tool.server === serverName) toolStore.items.delete(name) // 只删除目标服务拥有的动态工具
  }
}


// --- 将远程工具清单同步到 Agent 注册表 ---
async function syncTools(serverName, runtime) {
  removeTools(serverName)                                                         // 远端清单是完整快照，先清理旧注册项
  const response = await runtime.client.listTools()                               // 通过真实 MCP 连接读取工具定义
  for (const remoteTool of response.tools) {
    const name = createToolName(serverName, remoteTool.name)                      // 为 Agent 创建无冲突名称
    toolStore.items.set(name, {
      name,                                                                        // Agent 模型实际调用的名称
      label: remoteTool.title || remoteTool.name,                                  // 界面优先展示 MCP 提供的人类标题
      description: remoteTool.description || `MCP ${serverName} 提供的 ${remoteTool.name}`, // 缺少说明时保留来源语义
      inputSchema: remoteTool.inputSchema || { type: 'object', properties: {} },   // 原样保留 JSON Schema 交给 AI SDK
      source: `mcp:${serverName}`,                                                  // 工具页可识别动态来源
      kind: 'mcp',                                                                 // 对话 UI 可使用 MCP 视觉身份
      server: serverName,                                                          // 记录连接归属用于重载清理
      originalName: remoteTool.name,                                               // 调用远端时恢复原始名称
      async execute(input) {
        const current = capabilityStore.mcp.get(serverName)                       // 每次调用读取最新重连后的客户端
        if (current?.status !== 'connected') throw new Error(`MCP 服务 ${serverName} 未连接`) // 断线时不调用陈旧对象
        return current.client.callTool({ name: remoteTool.name, arguments: input }) // 将真实结构化结果反馈给模型
      },
    })
  }
  runtime.toolCount = response.tools.length                                        // 状态页显示实际发现数量
  runtime.updatedAt = new Date().toISOString()                                     // 记录最近一次成功同步时间
}


// --- 连接一个 MCP 服务 ---
async function connect(serverName, definition) {
  const runtime = { name: serverName, status: 'connecting', error: '', toolCount: 0, transport: definition.transport || 'stdio' } // 先反馈正在连接
  capabilityStore.mcp.set(serverName, runtime)                                     // 让 API 立即观察连接状态
  if (definition.enabled === false) { runtime.status = 'disabled'; return runtime } // 明确关闭的服务不产生进程或网络副作用

  try {
    const client = new Client({ name: 'agent-workbench', version: '0.1.0' })        // 使用官方 SDK 创建协议客户端
    const transport = runtime.transport === 'http'
      ? new StreamableHTTPClientTransport(new URL(definition.url), { requestInit: { headers: definition.headers || {} } }) // HTTP 使用用户地址和请求头
      : new StdioClientTransport({ command: definition.command, args: definition.args || [], cwd: definition.cwd || capabilityStore.workspaceDirectory, env: { ...process.env, ...(definition.env || {}) }, stderr: 'pipe' }) // stdio 启动真实本地服务
    runtime.client = client                                                        // 保存重载和调用使用的客户端
    runtime.transportObject = transport                                            // 保存关闭所需传输对象
    client.onclose = () => {
      if (runtime.status === 'closing') return                                     // 主动关闭不覆盖最终状态
      runtime.status = 'disconnected'                                              // 意外断线立即反馈能力不可用
      runtime.error = '连接已关闭'                                                  // 提供可理解的状态原因
      removeTools(serverName)                                                      // 模型不能继续看到不可执行工具
    }
    client.onerror = (error) => { runtime.error = error.message }                  // 协议错误保留给能力中心检查
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => syncTools(serverName, runtime).catch((error) => { runtime.error = error.message })) // 服务热更新后同步工具
    await client.connect(transport)                                                 // 执行 initialize 握手并启动传输
    runtime.status = 'connected'                                                    // 握手完成后才声明可用
    await syncTools(serverName, runtime)                                            // 工具发现成功后进入 Agent 注册表
  } catch (error) {
    runtime.status = 'error'                                                       // 连接或发现失败保留配置供用户修复
    runtime.error = error.message                                                  // 不泄漏环境变量，只反馈 SDK 错误
    removeTools(serverName)                                                        // 失败服务不能残留上次工具
  }
  return runtime                                                                   // 单服务失败不阻断其他服务启动
}


// --- 关闭一个 MCP 运行连接 ---
async function closeRuntime(runtime) {
  if (!runtime?.client) return                                                     // 未连接或禁用服务没有资源可释放
  runtime.status = 'closing'                                                       // 阻止 onclose 将主动退出标为故障
  try { await runtime.client.close() } catch {}                                     // 关闭失败不能阻止应用退出
  runtime.status = 'disconnected'                                                  // 反馈资源已经离开可用状态
}


// --- 重载全部 MCP 服务 ---
async function reload() {
  await Promise.all([...capabilityStore.mcp.values()].map(closeRuntime))            // 先关闭旧客户端和子进程
  for (const name of capabilityStore.mcp.keys()) removeTools(name)                  // 清理旧服务的动态工具
  capabilityStore.mcp.clear()                                                       // 新状态只反映最新配置
  const servers = Config.get().mcpServers || {}                                     // 读取刚持久化的完整 MCP 声明
  await Promise.all(Object.entries(servers).map(([name, definition]) => connect(name, definition))) // 服务彼此独立并行连接
  return { ok: true, servers: list() }                                              // 返回真实连接结果供页面立即刷新
}


// --- 列出 MCP 服务状态 ---
function list() {
  const definitions = Config.get().mcpServers || {}                                 // 禁用且尚未加载的配置也需要展示
  return Object.entries(definitions).map(([name, definition]) => {
    const runtime = capabilityStore.mcp.get(name)                                   // 合并瞬时连接数据
    return { name, transport: definition.transport || 'stdio', enabled: definition.enabled !== false, status: runtime?.status || 'configured', error: runtime?.error || '', toolCount: runtime?.toolCount || 0, updatedAt: runtime?.updatedAt || '' }
  })
}


// --- 关闭全部 MCP 服务 ---
async function close() {
  await Promise.all([...capabilityStore.mcp.values()].map(closeRuntime))            // 并行释放全部网络和子进程资源
  for (const name of capabilityStore.mcp.keys()) removeTools(name)                  // 清理模型动态工具
  capabilityStore.mcp.clear()                                                       // 允许下一次应用启动重新连接
}


export const MCP = { reload, list, close }                                           // 导出配置重载、状态读取和生命周期动作
