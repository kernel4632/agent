/*
文件工具集：读取、写入、列出和搜索本地文件。
path 是每个文件工具自己的目标参数，commands/tool.js 会先把相对路径展开为工作区绝对路径。
调用示例：await readFileTool.execute({ path: 'D:/project/README.md' }, signal)。
*/
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises' // 引入真实文件读写能力
import { dirname, join } from 'node:path'                // 引入父目录和搜索路径拼接能力


// --- 读取文本文件 ---
export const readFileTool = {
  name: 'file_read',                                    // LLM 调用使用对象在前的稳定工具名
  description: '读取指定路径的文本文件内容。',         // 说明该工具用于读取文本
  parameters: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      path: { type: 'string', description: '文件路径' }, // 支持绝对路径和工作区相对路径
    },
    required: ['path'],                                 // 读取必须明确目标文件
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path }, signal) {
    signal.throwIfAborted()                              // 已停止任务不再读取文件
    return { output: await readFile(path, { encoding: 'utf-8', signal }) } // 返回完整文本
  },
}


// --- 写入文本文件 ---
export const writeFileTool = {
  name: 'file_write',                                   // LLM 调用使用对象在前的稳定工具名
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
  async execute({ path, content, mode = 'overwrite' }, signal) {
    signal.throwIfAborted()                              // 已停止任务不再修改文件
    await mkdir(dirname(path), { recursive: true })     // 写入前创建父目录
    if (mode === 'append') await appendFile(path, content, { encoding: 'utf-8', signal }) // 追加到文件末尾
    else await writeFile(path, content, { encoding: 'utf-8', signal }) // 覆盖目标文件
    return { output: `文件已写入: ${path}` }            // 向模型反馈实际路径
  },
}


// --- 列出目录内容 ---
export const listFilesTool = {
  name: 'file_list',                                    // LLM 调用使用对象在前的稳定工具名
  description: '列出目录中的文件和子目录。',           // 说明只列出当前一层
  parameters: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      path: { type: 'string', description: '目录路径' }, // 目标目录位置
    },
    required: ['path'],                                 // 必须明确目标目录
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path }, signal) {
    signal.throwIfAborted()                              // 已停止任务不再读取目录
    const entries = await readdir(path, { withFileTypes: true }) // 读取当前目录条目
    const output = entries.map((entry) => `${entry.isDirectory() ? 'directory' : 'file'}: ${entry.name}`).join('\n') // 输出稳定文本列表
    return { output }                                   // 将列表反馈给模型
  },
}


// --- 搜索文件名称 ---
export const searchFilesTool = {
  name: 'file_search',                                  // LLM 调用使用对象在前的稳定工具名
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
  async execute({ path, keyword }, signal) {
    const matches = []                                  // 按发现顺序保存匹配路径
    const directories = [path]                          // 从目标目录开始广度遍历
    while (directories.length > 0) {
      signal.throwIfAborted()                            // 每层目录之间响应用户停止
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


export default [readFileTool, writeFileTool, listFilesTool, searchFilesTool] // 让 utils/Tool.scan 自动注册全部文件工具
