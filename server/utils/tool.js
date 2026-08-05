/*
工具注册和执行基础设施：扫描工具目录、生成 LLM 工具定义、执行工具并收集结果。
工具可以返回三种形式：ReadableStream（流式输出）、对象 { output, isError?, stop? }、或字符串。
框架自动处理 signal 检查、流式读取、错误捕获和结果归一化。

使用示例
await Tool.scan('./tools')

const execution = Tool.execute('shell', { command: 'npm install' }, {
  onOutput(chunk) { console.log(chunk) }
})
const { output, isError, stop } = await execution.result
execution.abort()  // 用户停止
*/
import { readdir } from 'node:fs/promises'               // 引入平铺工具目录扫描能力
import { join, resolve } from 'node:path'                // 引入工具目录和模块路径定位能力
import { pathToFileURL } from 'node:url'                 // 引入跨平台动态导入地址
import { errorMessage } from './error.js'                // 引入错误消息安全提取

let registry = new Map()                                 // 保存当前一次扫描得到的工具


// --- 扫描工具目录 ---
async function scan(folder) {
  const directory = resolve(folder)                      // 相对目录转换为稳定绝对路径
  const entries = await readdir(directory, { withFileTypes: true }) // 读取当前目录全部条目
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => entry.name).sort() // 只按稳定顺序加载平铺 JS 文件
  const modules = await Promise.all(files.map((file) => import(pathToFileURL(join(directory, file)).href))) // 并行导入全部工具模块
  const nextRegistry = new Map()                         // 扫描成功前不修改现有注册表

  for (const module of modules) {
    const tools = Array.isArray(module.default) ? module.default : [module.default] // 默认导出可以是一项或一组工具
    for (const tool of tools) nextRegistry.set(tool.name, { description: tool.description, parameters: tool.parameters, execute: tool.execute }) // 同名工具使用后加载定义
  }
  registry = nextRegistry                                // 完整扫描成功后一次替换注册表
  return definitions()                                   // 反馈模型可以直接使用的全部定义
}


// --- 读取工具定义 ---
function definitions() {
  return Object.fromEntries([...registry].map(([name, tool]) => [name, { description: tool.description, parameters: structuredClone(tool.parameters) }])) // 调用方不能修改注册表数据
}


// --- 执行工具 ---
function execute(name, input, { onOutput } = {}) {
  const tool = registry.get(name)                        // 按模型返回名称定位工具
  if (!tool) return { result: Promise.resolve({ output: `tool not found: ${name}`, isError: true, stop: false }), abort() {} }

  let output = ''                                        // 累积流式输出供最终结果
  let reader = null                                      // 流式工具的读取器供停止使用
  const controller = new AbortController()               // 每次执行拥有独立停止信号

  const result = (async () => {
    try {
      controller.signal.throwIfAborted()                 // 框架统一做执行前检查，工具不需要自己写
      const raw = await tool.execute(input, controller.signal) // 工具只接收输入和信号
      if (controller.signal.aborted) return aborted(output)

      // 流式返回：工具返回 ReadableStream，框架逐段读取并实时反馈
      if (raw instanceof ReadableStream) {
        reader = raw.getReader()
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = typeof value === 'string' ? value : new TextDecoder().decode(value)
          output += chunk
          onOutput?.(chunk)
        }
        if (controller.signal.aborted) return aborted(output)
        return { output, isError: false, stop: false }
      }

      // 对象返回：工具返回 { output, isError?, stop? }
      if (typeof raw === 'object' && raw !== null) {
        output = raw.output ?? ''
        onOutput?.(output)
        return { output, isError: raw.isError ?? false, stop: raw.stop ?? false }
      }

      // 原始值返回：字符串或其他原始值当作成功输出
      output = String(raw ?? '')
      onOutput?.(output)
      return { output, isError: false, stop: false }
    } catch (error) {
      if (controller.signal.aborted) return aborted(output)
      const message = errorMessage(error)
      onOutput?.(message)
      return { output: message, isError: true, stop: false }
    }
  })()

  return {
    result,
    abort() {
      controller.abort(new DOMException('tool stopped', 'AbortError'))
      if (reader) void reader.cancel().catch(() => {})
    },
  }
}


// --- 被中止时的统一返回 ---
function aborted(partialOutput) {
  return { output: `${partialOutput}\n[工具被强制终止]`.trim(), isError: true, stop: false }
}


export const Tool = { scan, definitions, execute }
