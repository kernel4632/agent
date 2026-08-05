/*
文件工具集：读取、写入、列出和搜索本地文件。
path 是每个文件工具自己的目标参数，模型必须传入绝对路径。
调用示例：await readFileTool.execute({ path: 'D:/project/README.md' }, signal)。
*/
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises' // 引入真实文件读写能力
import { dirname } from 'node:path'                      // 引入父目录定位能力
import { fdir } from 'fdir'                              // 引入高性能目录递归遍历


// --- 检测图片格式 ---
function detectImage(buffer) {
  if (buffer.length < 12) return null
  const h = buffer.subarray(0, 12)                       // 取前 12 字节判断文件签名
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47) return 'image/png'
  if (h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) return 'image/jpeg'
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38) return 'image/gif'
  if (h[0] === 0x42 && h[1] === 0x4D) return 'image/bmp'
  if (h[0] === 0x49 && h[1] === 0x49 && h[2] === 0x2A && h[3] === 0x00) return 'image/tiff'
  if (h[0] === 0x4D && h[1] === 0x4D && h[2] === 0x00 && h[3] === 0x2A) return 'image/tiff'
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) return 'image/webp'
  if (h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) return 'image/avif' // ftyp box: AVIF/HEIF
  return null
}


// --- 读取文件 ---
export const readFileTool = {
  name: 'file_read',                                    // LLM 调用使用对象在前的稳定工具名
  description: '读取指定路径的文件内容。文本文件返回文本，图片文件返回图片供模型直接查看。',
  parameters: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      path: { type: 'string', description: '文件绝对路径' }, // 模型必须提供绝对路径
    },
    required: ['path'],                                 // 读取必须明确目标文件
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path }, signal) {
    const buffer = await readFile(path, { signal })     // 先以 buffer 读取完整文件
    const mime = detectImage(buffer)                    // 检测文件头判断是否为图片
    if (mime) return { output: { image: buffer.toString('base64'), mime } } // 图片返回 base64 + MIME
    return { output: buffer.toString('utf-8') }        // 非图片当作文本返回
  },
}


// --- 写入文本文件 ---
export const writeFileTool = {
  name: 'file_write',                                   // LLM 调用使用对象在前的稳定工具名
  description: '覆盖或追加写入文本文件，不存在时创建父目录。', // 明确该工具会修改磁盘
  parameters: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      path: { type: 'string', description: '文件绝对路径' }, // 目标文件位置
      content: { type: 'string', description: '写入内容' }, // 本次写入文本
      mode: { type: 'string', enum: ['overwrite', 'append'], description: '覆盖或追加', default: 'overwrite' }, // 明确写入方式
    },
    required: ['path', 'content'],                      // 路径和正文都必须提供
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path, content, mode = 'overwrite' }, signal) {
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
      path: { type: 'string', description: '目录绝对路径' }, // 目标目录位置
    },
    required: ['path'],                                 // 必须明确目标目录
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path }, signal) {
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
      path: { type: 'string', description: '起始目录绝对路径' }, // 搜索根目录
      keyword: { type: 'string', description: '文件名关键词' }, // 名称匹配文本
    },
    required: ['path', 'keyword'],                      // 根目录和关键词都必须提供
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ path, keyword }) {
    const matches = await new fdir()                    // 创建高性能目录遍历器
      .withFullPaths()                                  // 返回绝对路径
      .filter((filePath) => filePath.includes(keyword)) // 只保留名称包含关键词的文件
      .crawl(path)                                      // 从指定目录开始递归
      .withPromise()                                    // 异步执行遍历
    return { output: matches.join('\n') }              // 将全部匹配路径反馈给模型
  },
}


export default [readFileTool, writeFileTool, listFilesTool, searchFilesTool] // 让 utils/Tool.scan 自动注册全部文件工具
