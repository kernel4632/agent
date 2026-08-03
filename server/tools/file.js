/*
文件工具集：读取、写入、列出和搜索本地文件。
工具元数据会在启动扫描后进入 store.tools，执行函数只由 commands/tool.js 调用。
调用示例：await readFileTool.execute({ path: 'README.md' }, context)。
*/
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises' // 引入真实文件读写能力
import { dirname, isAbsolute, join, resolve } from 'node:path' // 引入工作区相对路径定位能力


// --- 读取文本文件 ---
export const readFileTool = {
  name: 'read_file',                                    // LLM 调用使用的稳定工具名
  description: '读取指定路径的文本文件内容。',         // 说明该工具用于读取文本
  parameters: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      path: { type: 'string', description: '文件路径' }, // 支持绝对路径和工作区相对路径
    },
    required: ['path'],                                 // 读取必须明确目标文件
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path, __context: context }) {
    context.abortSignal?.throwIfAborted()               // 已停止会话不再读取文件
    const filePath = resolvePath(context.cwd, path)     // 相对路径从会话工作区解析
    return { output: await readFile(filePath, { encoding: 'utf-8', signal: context.abortSignal }) } // 返回完整文本
  },
}


// --- 写入文本文件 ---
export const writeFileTool = {
  name: 'write_file',                                   // LLM 调用使用的稳定工具名
  description: '覆盖或追加写入文本文件，不存在时创建父目录。', // 明确该工具会修改磁盘
  parameters: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      path: { type: 'string', description: '文件路径' }, // 目标文件位置
      content: { type: 'string', description: '写入内容' }, // 本次写入文本
      mode: { type: 'string', enum: ['overwrite', 'append'], description: '覆盖或追加', default: 'overwrite' }, // 明确写入方式
    },
    required: ['path', 'content'],                      // 路径和正文都必须提供
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path, content, mode = 'overwrite', __context: context }) {
    context.abortSignal?.throwIfAborted()               // 已停止会话不再修改文件
    const filePath = resolvePath(context.cwd, path)     // 相对路径从会话工作区解析
    await mkdir(dirname(filePath), { recursive: true }) // 写入前创建父目录
    if (mode === 'append') await appendFile(filePath, content, { encoding: 'utf-8', signal: context.abortSignal }) // 追加到文件末尾
    else await writeFile(filePath, content, { encoding: 'utf-8', signal: context.abortSignal }) // 覆盖目标文件
    return { output: `文件已写入: ${filePath}` }        // 向模型反馈实际路径
  },
}


// --- 列出目录内容 ---
export const listFilesTool = {
  name: 'list_files',                                   // LLM 调用使用的稳定工具名
  description: '列出目录中的文件和子目录。',           // 说明只列出当前一层
  parameters: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      path: { type: 'string', description: '目录路径' }, // 目标目录位置
    },
    required: ['path'],                                 // 必须明确目标目录
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path, __context: context }) {
    context.abortSignal?.throwIfAborted()               // 已停止会话不再读取目录
    const directory = resolvePath(context.cwd, path)    // 相对路径从会话工作区解析
    const entries = await readdir(directory, { withFileTypes: true }) // 读取当前目录条目
    const output = entries.map((entry) => `${entry.isDirectory() ? 'directory' : 'file'}: ${entry.name}`).join('\n') // 输出稳定文本列表
    return { output }                                   // 将列表反馈给模型
  },
}


// --- 搜索文件名称 ---
export const searchFilesTool = {
  name: 'search_files',                                 // LLM 调用使用的稳定工具名
  description: '递归查找目录中名称包含关键词的文件。', // 搜索只匹配文件名
  parameters: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      path: { type: 'string', description: '起始目录' }, // 搜索根目录
      keyword: { type: 'string', description: '文件名关键词' }, // 名称匹配文本
    },
    required: ['path', 'keyword'],                      // 根目录和关键词都必须提供
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path, keyword, __context: context }) {
    const matches = []                                  // 按发现顺序保存匹配路径
    const directories = [resolvePath(context.cwd, path)] // 从目标目录开始广度遍历
    while (directories.length > 0) {
      context.abortSignal?.throwIfAborted()             // 每层目录之间响应用户停止
      const directory = directories.shift()             // 取出下一待检查目录
      const entries = await readdir(directory, { withFileTypes: true }) // 读取真实目录条目
      for (const entry of entries) {
        const entryPath = join(directory, entry.name)    // 构造完整条目路径
        if (entry.isDirectory()) directories.push(entryPath) // 子目录加入后续队列
        if (entry.isFile() && entry.name.includes(keyword)) matches.push(entryPath) // 名称匹配时记录文件
      }
    }
    return { output: matches.join('\n') }              // 将全部匹配路径反馈给模型
  },
}


// --- 解析工作区路径 ---
function resolvePath(cwd, path) {
  return isAbsolute(path) ? path : resolve(cwd, path)    // 绝对路径保持原值，相对路径绑定会话工作区
}


export default [readFileTool, writeFileTool, listFilesTool, searchFilesTool] // 让 utils/Tool.scan 自动注册全部文件工具
