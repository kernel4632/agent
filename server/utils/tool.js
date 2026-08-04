/*
工具运行工具：扫描默认导出、保存注册表，并把不同输出统一成可中止任务。
本文件不读取 store 或会话，执行所需上下文全部由调用方显式传入。
调用示例：const execution = Tool.execute(toolCall, context)。
*/
import { readdir } from 'node:fs/promises'               // 引入平铺工具目录扫描能力
import { join, resolve } from 'node:path'                // 引入工具目录和模块路径定位能力
import { pathToFileURL } from 'node:url'                 // 引入跨平台动态导入地址

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
function execute(toolCall, context = {}, { onOutput } = {}) {
  const name = toolCall.toolName                          // 读取模型声明的工具名称
  const input = toolCall.input ?? {}                     // 直接读取 AI SDK ToolCallPart 输入
  const tool = registry.get(name)                        // 按模型返回名称定位工具
  if (!tool) return { result: Promise.resolve({ output: `tool not found: ${name}`, isError: true, stop: false }), abort() {} } // 未注册名称返回稳定错误结果

  let output = ''                                        // 累积普通结果或流式输出
  let aborted = false                                    // 记录调用方是否主动停止
  let reader = null                                      // 流式工具使用读取器响应停止

  const result = (async () => {
    try {
      const raw = await tool.execute({ ...input, __context: context }) // 将业务输入和运行上下文一次交给工具
      if (aborted) return { output: `${output}\n[工具被强制终止]`, isError: true, stop: false } // 停止后的迟到结果不能成为成功

      if (raw instanceof ReadableStream) {
        reader = raw.getReader()                         // 锁定输出流供读取和停止
        while (!aborted) {
          const { done, value } = await reader.read()    // 逐段读取工具输出
          if (done) break                                // 流正常结束后返回完整内容
          const chunk = typeof value === 'string' ? value : new TextDecoder().decode(value) // 字节输出统一转成文本
          output += chunk                                // 累积完整工具反馈
          onOutput?.(chunk)                              // 同时反馈实时增量
        }
        if (aborted) return { output: `${output}\n[工具被强制终止]`, isError: true, stop: false } // 中止流返回明确错误
        return { output, isError: false, stop: false }    // 正常流不要求额外结果对象
      }

      if (typeof raw === 'object' && raw !== null) {
        output = raw.output ?? ''                        // 工具对象可以同时声明错误和停止
        onOutput?.(output)                               // 对象输出也走统一反馈入口
        return { output, isError: raw.isError ?? false, stop: raw.stop ?? false } // 补齐统一结果字段
      }

      output = String(raw ?? '')                         // 普通值统一转成文本
      onOutput?.(output)                                 // 反馈完整普通输出
      return { output, isError: false, stop: false }      // 普通值默认表示成功并继续
    } catch (error) {
      if (aborted) return { output: `${output}\n[工具被强制终止]`, isError: true, stop: false } // 停止优先于迟到异常
      const message = error instanceof Error ? error.message : String(error) // 任意抛出值转成稳定反馈文本
      onOutput?.(message)                                // 错误也通过同一个输出入口反馈
      return { output: message, isError: true, stop: false } // 工具错误交给模型继续处理
    }
  })()

  return {
    result,                                              // 调用方等待统一完成结果
    abort() {
      aborted = true                                    // 阻止迟到结果成为成功
      reader?.cancel()                                   // 立即停止正在读取的输出流
    },
  }
}


// --- 读取错误文本 ---
function errorText(error) {
  return error instanceof Error ? error.message : String(error) // 任意抛出值转成稳定工具反馈
}


export const Tool = { scan, definitions, execute, errorText } // 导出扫描、定义、执行和错误文本能力
