/*
LSP 指令集：管理语言服务器进程与 JSON-RPC 生命周期，并提供诊断、定义、引用和悬停工具。
每次工具触发先同步磁盘文档，再发送标准 LSP 请求；结果回到现有工具执行与审批反馈链。
调用示例：await LSP.reload()、LSP.list()、await LSP.close()。
*/
import { spawn } from 'node:child_process'                               // 引入真实语言服务器子进程能力
import { readFile } from 'node:fs/promises'                              // 引入磁盘文档同步能力
import { extname, isAbsolute, resolve } from 'node:path'                  // 引入扩展名匹配和工作区路径解析
import { fileURLToPath, pathToFileURL } from 'node:url'                   // 引入 LSP DocumentUri 转换能力
import { createMessageConnection } from 'vscode-jsonrpc/node'            // 引入官方 VS Code JSON-RPC 流实现
import { Config } from './config.js'                                     // 引入语言服务器声明
import { capabilityStore } from '../store/capabilities.js'               // 引入进程、诊断和文档运行状态
import { toolStore } from '../store/tools.js'                            // 引入 Agent 统一工具注册表


// --- 创建语言服务器公开状态 ---
function publicState(name, definition, runtime) {
  return { name, enabled: definition.enabled !== false, status: runtime?.status || 'configured', error: runtime?.error || '', extensions: definition.extensions || [], languageId: definition.languageId || '', capabilities: runtime?.capabilities ? Object.keys(runtime.capabilities).filter((key) => runtime.capabilities[key]) : [] } // 只暴露可检查字段
}


// --- 找到文件对应的语言服务器 ---
function findServer(filePath, requestedName) {
  const servers = Config.get().lspServers || {}                             // 每次调用读取最新声明
  if (requestedName) {
    const definition = servers[requestedName]                              // 显式服务用于扩展名重叠场景
    if (!definition || definition.enabled === false) throw new Error(`LSP 服务不可用: ${requestedName}`) // 禁用或不存在均不能执行
    return [requestedName, definition]
  }
  const extension = extname(filePath).toLowerCase().replace(/^\./, '')      // 配置接受 js 或 .js 两种写法
  const match = Object.entries(servers).find(([, definition]) => definition.enabled !== false && (definition.extensions || []).some((item) => String(item).toLowerCase().replace(/^\./, '') === extension)) // 按扩展名选择第一个启用服务
  if (!match) throw new Error(`没有为 .${extension || '(无扩展名)'} 配置 LSP 服务`) // 提示用户完善映射
  return match
}


// --- 解析服务与文件路径 ---
function resolveDocument(filePath, serverName, definition) {
  const root = resolve(definition.root || capabilityStore.workspaceDirectory) // 相对根目录以 Agent 工作区为基准
  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath) // 模型通常传入工作区相对路径
  return { serverName, definition, root, absolutePath, uri: pathToFileURL(absolutePath).href } // 统一准备 LSP 请求上下文
}


// --- 创建语言服务器连接 ---
async function connect(serverName, definition) {
  const root = resolve(definition.root || capabilityStore.workspaceDirectory) // 每个服务器可覆盖项目根目录
  const runtime = { name: serverName, status: 'starting', error: '', diagnostics: new Map(), documents: new Map(), capabilities: {}, root } // 先建立可观察状态
  capabilityStore.lsp.set(serverName, runtime)                              // API 立即可看到启动过程
  if (definition.enabled === false) { runtime.status = 'disabled'; return runtime } // 禁用服务不创建进程

  try {
    const child = spawn(definition.command, definition.args || [], { cwd: root, env: { ...process.env, ...(definition.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }) // 启动真实语言服务器 stdio 进程
    const connection = createMessageConnection(child.stdout, child.stdin)    // LSP 使用 Content-Length JSON-RPC 帧
    runtime.child = child                                                     // 保存关闭和异常反馈需要的进程
    runtime.connection = connection                                           // 保存工具请求复用的连接
    let stderr = ''                                                            // 只保留有限错误尾部供设置页排查
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000) }) // 不将服务器日志写入 Agent stdout
    child.on('error', (error) => { runtime.status = 'error'; runtime.error = error.message }) // 命令不存在等启动错误立即反馈
    child.on('exit', (code) => {
      if (runtime.status === 'closing' || runtime.status === 'disabled') return // 主动退出不标为故障
      runtime.status = 'disconnected'                                           // 异常退出后工具拒绝调用
      runtime.error = stderr.trim() || `语言服务器已退出 (${code ?? 'unknown'})` // 优先反馈真实 stderr
    })
    connection.onNotification('textDocument/publishDiagnostics', ({ uri, diagnostics }) => runtime.diagnostics.set(uri, diagnostics || [])) // 缓存 push diagnostics
    connection.onRequest('workspace/configuration', ({ items }) => (items || []).map(() => null)) // 以空配置响应服务器动态查询
    connection.onRequest('client/registerCapability', () => null)              // 接受动态能力注册，当前工具按请求失败反馈
    connection.onRequest('client/unregisterCapability', () => null)            // 接受动态能力注销
    connection.onRequest('window/workDoneProgress/create', () => null)          // 允许服务器创建进度 token
    connection.onRequest('workspace/applyEdit', () => ({ applied: false, failureReason: 'Agent LSP tools are read-only' })) // LSP 工具当前只读，禁止隐式修改文件
    connection.listen()                                                         // 开始消费服务响应和通知

    const rootUri = pathToFileURL(root).href                                    // 初始化使用标准文件 URI
    const initialized = await connection.sendRequest('initialize', {
      processId: process.pid,                                                    // 服务可监视 Agent 生命周期
      clientInfo: { name: 'agent-workbench', version: '0.1.0' },                 // 提供可识别客户端身份
      rootUri,                                                                   // 声明当前真实项目根目录
      workspaceFolders: [{ uri: rootUri, name: root.split(/[\\/]/).at(-1) || 'workspace' }], // 支持 workspace-aware 服务
      capabilities: {
        general: { positionEncodings: ['utf-16'] },                              // 使用 LSP 默认且必需的位置编码
        workspace: { workspaceFolders: true, configuration: true },              // 支持常见配置与工作区查询
        textDocument: { synchronization: { didSave: true }, definition: {}, references: {}, hover: {}, publishDiagnostics: { relatedInformation: true }, diagnostic: {} }, // 声明实际实现的只读能力
      },
    })
    runtime.capabilities = initialized?.capabilities || {}                       // 保存服务声明供状态页检查
    await connection.sendNotification('initialized', {})                         // 完成标准生命周期握手
    runtime.status = 'connected'                                                  // 只有 initialize 完成后才可执行工具
  } catch (error) {
    runtime.status = 'error'                                                      // 启动或握手失败保留配置
    runtime.error = error.message                                                 // 状态页显示真实原因
    runtime.child?.kill()                                                         // 握手失败释放残留进程
  }
  return runtime                                                                  // 单服务错误不阻断其他能力
}


// --- 确保语言服务器已经连接 ---
async function ensureConnected(serverName, definition) {
  const current = capabilityStore.lsp.get(serverName)                             // 查找启动时或上次请求创建的连接
  if (current?.status === 'connected') return current                             // 可用连接直接复用文档状态
  if (current) await closeRuntime(current)                                         // 清理错误或断开的残留进程
  const runtime = await connect(serverName, definition)                           // 重新执行完整 initialize 生命周期
  if (runtime.status !== 'connected') throw new Error(runtime.error || `LSP 服务 ${serverName} 连接失败`) // 工具调用获得明确失败
  return runtime
}


// --- 将磁盘文档同步给语言服务器 ---
async function openDocument(runtime, document, languageId) {
  const text = await readFile(document.absolutePath, 'utf8')                       // 每次请求读取最新磁盘内容
  const previous = runtime.documents.get(document.uri)                            // 查找服务器已知版本
  if (!previous) {
    runtime.documents.set(document.uri, { version: 1, text })                      // 建立首个同步版本
    await runtime.connection.sendNotification('textDocument/didOpen', { textDocument: { uri: document.uri, languageId, version: 1, text } }) // 首次打开发送完整文本
  } else if (previous.text !== text) {
    const version = previous.version + 1                                           // 磁盘变化递增版本
    runtime.documents.set(document.uri, { version, text })                         // 先保存将要发送的快照
    await runtime.connection.sendNotification('textDocument/didChange', { textDocument: { uri: document.uri, version }, contentChanges: [{ text }] }) // 使用 full sync 保持客户端简单可靠
  }
  return text                                                                      // 反馈文本供后续扩展使用
}


// --- 准备一次 LSP 工具请求 ---
async function prepareRequest({ path, server }) {
  const [serverName, definition] = findServer(path, server)                       // 按显式名称或扩展名选择服务
  const document = resolveDocument(path, serverName, definition)                  // 创建绝对路径和 URI
  const runtime = await ensureConnected(serverName, definition)                   // 保证握手完成
  await openDocument(runtime, document, definition.languageId || document.absolutePath.slice(document.absolutePath.lastIndexOf('.') + 1)) // 同步当前文件
  return { runtime, document, serverName }                                         // 返回请求所需完整上下文
}


// --- 将 LSP 位置转为模型可读位置 ---
function normalizeLocation(location) {
  if (!location) return null                                                       // 空定义结果保持空值
  const uri = location.uri || location.targetUri                                   // 同时支持 Location 与 LocationLink
  const range = location.range || location.targetSelectionRange                    // 优先使用可跳转选择范围
  let path = uri
  try { path = fileURLToPath(uri) } catch {}                                        // 非 file URI 原样保留
  return { path, line: (range?.start?.line ?? 0) + 1, character: (range?.start?.character ?? 0) + 1, endLine: (range?.end?.line ?? 0) + 1, endCharacter: (range?.end?.character ?? 0) + 1 } // Agent 对外统一使用 1-based 坐标
}


// --- 注册 Agent 可调用的 LSP 工具 ---
function registerTools() {
  const positionParameters = { path: { type: 'string', required: true, description: '工作区相对或绝对文件路径' }, line: { type: 'number', required: true, description: '从 1 开始的行号' }, character: { type: 'number', required: true, description: '从 1 开始的 UTF-16 列号' }, server: { type: 'string', required: false, description: '可选 LSP 服务名' } } // 三个导航工具共享坐标协议
  toolStore.items.set('lsp_diagnostics', { name: 'lsp_diagnostics', label: '检查代码诊断', description: '使用已配置的语言服务器检查文件错误、警告和提示。', parameters: { path: positionParameters.path, server: positionParameters.server }, source: 'lsp', kind: 'lsp', execute: diagnostics }) // 注册诊断能力
  toolStore.items.set('lsp_definition', { name: 'lsp_definition', label: '查找定义', description: '通过语言服务器查找符号定义位置。行号和列号从 1 开始。', parameters: positionParameters, source: 'lsp', kind: 'lsp', execute: (input) => locations('textDocument/definition', input) }) // 注册定义跳转
  toolStore.items.set('lsp_references', { name: 'lsp_references', label: '查找引用', description: '通过语言服务器查找符号的全部引用。行号和列号从 1 开始。', parameters: positionParameters, source: 'lsp', kind: 'lsp', execute: (input) => locations('textDocument/references', input, { context: { includeDeclaration: true } }) }) // 注册引用查询
  toolStore.items.set('lsp_hover', { name: 'lsp_hover', label: '查看符号信息', description: '通过语言服务器读取符号类型、签名和文档。行号和列号从 1 开始。', parameters: positionParameters, source: 'lsp', kind: 'lsp', execute: hover }) // 注册悬停信息
}


// --- 获取文件诊断 ---
async function diagnostics(input) {
  const { runtime, document, serverName } = await prepareRequest(input)            // 同步文件并选择服务
  let items = runtime.diagnostics.get(document.uri) || []                          // 先读取 push diagnostics
  if (runtime.capabilities.diagnosticProvider) {
    try {
      const result = await runtime.connection.sendRequest('textDocument/diagnostic', { textDocument: { uri: document.uri } }) // 支持 LSP 3.17 pull diagnostics
      if (result?.kind === 'full') items = result.items || []                       // 完整报告替换缓存
    } catch {}                                                                      // 部分服务声明但未实现时仍可使用 push 结果
  } else {
    await new Promise((resolveWait) => setTimeout(resolveWait, 350))                // 给异步 publishDiagnostics 一个短窗口
    items = runtime.diagnostics.get(document.uri) || items                          // 读取通知后的最新结果
  }
  return { server: serverName, path: document.absolutePath, diagnostics: items.map((item) => ({ severity: ['unknown', 'error', 'warning', 'information', 'hint'][item.severity || 1], message: item.message, source: item.source || '', code: item.code ?? '', line: (item.range?.start?.line ?? 0) + 1, character: (item.range?.start?.character ?? 0) + 1 })) } // 返回紧凑可操作诊断
}


// --- 获取定义或引用位置 ---
async function locations(method, input, extra = {}) {
  const { runtime, document, serverName } = await prepareRequest(input)            // 准备标准文本位置请求
  const result = await runtime.connection.sendRequest(method, { textDocument: { uri: document.uri }, position: { line: Math.max(0, input.line - 1), character: Math.max(0, input.character - 1) }, ...extra }) // 将公开 1-based 坐标转为 LSP 0-based
  const values = Array.isArray(result) ? result : result ? [result] : []            // 定义可能返回单项、数组或 null
  return { server: serverName, locations: values.map(normalizeLocation).filter(Boolean) } // 统一位置结构反馈模型
}


// --- 获取符号悬停信息 ---
async function hover(input) {
  const { runtime, document, serverName } = await prepareRequest(input)            // 准备标准文本位置请求
  const result = await runtime.connection.sendRequest('textDocument/hover', { textDocument: { uri: document.uri }, position: { line: Math.max(0, input.line - 1), character: Math.max(0, input.character - 1) } }) // 请求真实类型与文档
  return { server: serverName, hover: result || null }                              // 保留 MarkupContent 结构给模型理解
}


// --- 关闭一个语言服务器 ---
async function closeRuntime(runtime) {
  if (!runtime?.connection) { runtime?.child?.kill(); return }                      // 握手前失败只需终止进程
  runtime.status = 'closing'                                                       // 退出事件不应标为意外断线
  try { await Promise.race([runtime.connection.sendRequest('shutdown'), new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), 1500))]) } catch {} // 尝试标准优雅关闭
  try { await runtime.connection.sendNotification('exit') } catch {}               // shutdown 后发送无响应 exit 通知
  runtime.connection.dispose()                                                     // 释放 JSON-RPC 监听器
  if (!runtime.child.killed) runtime.child.kill()                                   // 超时服务仍确保退出
  runtime.status = 'disconnected'                                                  // 反馈运行资源已经释放
}


// --- 重载全部语言服务器 ---
async function reload() {
  await Promise.all([...capabilityStore.lsp.values()].map(closeRuntime))            // 关闭旧进程避免重复索引
  capabilityStore.lsp.clear()                                                       // 新状态只对应最新配置
  registerTools()                                                                  // 固定 LSP 工具始终进入统一注册表
  const servers = Config.get().lspServers || {}                                     // 读取完整声明
  await Promise.all(Object.entries(servers).map(([name, definition]) => connect(name, definition))) // 并行握手全部启用服务
  return { ok: true, servers: list() }                                              // 状态页得到真实启动结果
}


// --- 列出语言服务器状态 ---
function list() {
  return Object.entries(Config.get().lspServers || {}).map(([name, definition]) => publicState(name, definition, capabilityStore.lsp.get(name))) // 合并配置和运行状态
}


// --- 关闭全部语言服务器 ---
async function close() {
  await Promise.all([...capabilityStore.lsp.values()].map(closeRuntime))            // 并行释放子进程
  capabilityStore.lsp.clear()                                                       // 允许下次启动重新握手
}


export const LSP = { reload, list, close }                                           // 导出连接重载、状态读取和生命周期动作
