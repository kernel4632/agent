/*
JSON 文件工具：把完整数据先写入同目录临时文件，再一次替换正式文件。
配置、工作区和会话共用这个动作，避免各自重复处理半写文件和临时文件清理。
调用示例：await writeJSON('D:/agent/config.json', store.config)。
*/
import { randomUUID } from 'node:crypto'                // 引入临时文件唯一身份
import { rename, rm } from 'node:fs/promises'           // 引入正式文件替换和临时文件清理能力


// --- 完整写入 JSON 文件 ---
export async function writeJSON(filePath, value) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp` // 临时文件与正式文件位于同一目录
  try {
    await Bun.write(temporaryPath, `${JSON.stringify(value, null, 2)}\n`) // 先写完全部 JSON 内容
    await rename(temporaryPath, filePath)               // 完整文件一次替换正式文件
  } finally {
    await rm(temporaryPath, { force: true })            // 成功或失败都不留下临时文件
  }
}
