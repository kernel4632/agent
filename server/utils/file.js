/*
文件写入工具：先完整写入新文件，再替换旧文件。
写入中途退出时旧文件仍可读取，可用于文本、JSON 或二进制内容。

使用示例
await File.write('D:/agent/config.json', JSON.stringify(config, null, 2))
await File.write('D:/agent/note.txt', '完整文本')
await File.write('D:/agent/data.bin', bytes)
*/
import { randomUUID } from 'node:crypto'                 // 引入临时文件唯一身份
import { rename, rm } from 'node:fs/promises'            // 引入旧文件替换和临时文件清理能力


// --- 写入完整文件 ---
async function write(path, content) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`    // 新文件与旧文件位于同一目录
  try {
    await Bun.write(temporaryPath, content)              // 新内容完整写入独立文件
    await rename(temporaryPath, path)                    // 写完后一次替换旧文件
  } finally {
    await rm(temporaryPath, { force: true })             // 成功或失败都不留下临时文件
  }
}


export const File = { write }                            // 导出唯一、直观的文件写入动作
