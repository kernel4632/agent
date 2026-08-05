/*
错误工具：从任意 throw 值中安全提取错误消息。
消除全项目 8+ 处 `error instanceof Error ? error.message : String(error)` 重复模式。

使用示例
const text = errorMessage(caughtValue)
*/


// --- 提取错误消息 ---
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
