/*
文件写入工具：跨平台原子写入，写入中途退出时旧文件仍可读取。
底层由 write-file-atomic 处理临时文件、重命名和 Windows 覆盖兼容。

使用示例
await File.write('D:/agent/config.json', JSON.stringify(config, null, 2))
await File.write('D:/agent/note.txt', '完整文本')
*/
import writeFileAtomic from 'write-file-atomic'          // 引入跨平台原子文件写入能力


// --- 写入完整文件 ---
async function write(path, content) {
  await writeFileAtomic(path, content)                    // 原子写入：tmp → rename，Windows 自动处理覆盖
}


export const File = { write }                            // 导出唯一、直观的文件写入动作
