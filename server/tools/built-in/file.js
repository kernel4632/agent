/*
文件工具集：提供读取、写入、列目录和按名称搜索四个真实文件操作。
所有路径由模型明确传入，权限判断统一在 commands/chat.js 执行。
调用示例：await read_file.execute({ path: 'README.md', encoding: 'utf-8' })。
*/
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises' // 引入真实文件读写与目录访问能力
import { dirname, join } from 'node:path'                              // 引入安全拼接和父目录提取能力


// --- 读取文本文件 ---
export const read_file = {                                            // 导出模型可调用的读取工具
  description: '读取指定路径的文本文件内容。',                        // 说明工具适用场景
  parameters: {                                                       // 定义模型生成参数的业务结构
    path: { type: 'string', description: '文件路径', required: true }, // 文件位置必须明确提供
    encoding: { type: 'string', description: '文本编码', default: 'utf-8' }, // 默认读取 UTF-8 文本
  },
  async execute({ path, encoding = 'utf-8' }) {
    const content = await readFile(path, encoding)                     // 从真实文件系统读取指定文本
    return { result: content }                                        // 将完整内容反馈给模型
  },
}


// --- 写入文本文件 ---
export const write_file = {                                           // 导出模型可调用的写入工具
  description: '将文本写入指定文件，不存在时创建父目录。',            // 明确该动作会修改磁盘
  parameters: {                                                       // 定义模型生成参数的业务结构
    path: { type: 'string', description: '文件路径', required: true }, // 目标位置必须明确提供
    content: { type: 'string', description: '要写入的文本', required: true }, // 写入正文不能为空参数
  },
  async execute({ path, content }) {
    await mkdir(dirname(path), { recursive: true })                    // 写文件前确保目标父目录存在
    await writeFile(path, content, 'utf-8')                            // 将正文真实写入目标文件
    return { result: `文件已写入: ${path}` }                           // 向模型反馈实际修改位置
  },
}


// --- 列出目录内容 ---
export const list_files = {                                           // 导出模型可调用的目录浏览工具
  description: '列出目录中的文件和子目录。',                          // 说明返回的是单层目录内容
  parameters: {                                                       // 定义模型生成参数的业务结构
    path: { type: 'string', description: '目录路径', required: true }, // 目标目录必须明确提供
  },
  async execute({ path }) {
    const entries = await readdir(path, { withFileTypes: true })       // 从真实目录读取带类型的条目
    const names = entries.map((entry) => `${entry.isDirectory() ? 'directory' : 'file'}: ${entry.name}`) // 转为稳定文本列表
    return { result: names.join('\n') }                               // 将目录内容逐行反馈给模型
  },
}


// --- 按名称搜索文件 ---
export const search_files = {                                         // 导出模型可调用的递归名称搜索工具
  description: '递归查找目录中名称包含关键词的文件。',                // 搜索只匹配名称，不读取正文
  parameters: {                                                       // 定义模型生成参数的业务结构
    path: { type: 'string', description: '起始目录', required: true }, // 搜索根目录必须明确提供
    keyword: { type: 'string', description: '文件名关键词', required: true }, // 名称匹配词必须明确提供
  },
  async execute({ path, keyword }) {
    const matches = []                                                // 按发现顺序保存匹配路径
    const directories = [path]                                       // 从用户给出的根目录开始广度遍历
    while (directories.length) {
      const directory = directories.shift()                          // 取出下一个待检查目录
      const entries = await readdir(directory, { withFileTypes: true }) // 读取当前目录的真实条目
      for (const entry of entries) {
        const entryPath = join(directory, entry.name)                 // 构造可直接使用的完整路径
        if (entry.isDirectory()) directories.push(entryPath)         // 子目录加入后续搜索队列
        if (entry.isFile() && entry.name.includes(keyword)) matches.push(entryPath) // 文件名匹配时记录路径
      }
    }
    return { result: matches.join('\n') }                            // 将全部匹配路径反馈给模型
  },
}
