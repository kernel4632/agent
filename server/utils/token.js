/*
Token 估算工具：用 tiktoken 编码器计算文本的 token 数量。
调用示例：Token.count('Hello world') → 2。
*/
import { encodingForModel } from 'js-tiktoken'           // 引入 tiktoken 编码能力

let encoder = null                                       // 延迟初始化，首次调用时创建


// --- 计算文本 token 数 ---
function count(text) {
  if (!encoder) encoder = encodingForModel('gpt-4o')     // 通用编码器，覆盖主流模型
  return encoder.encode(text).length
}


export const Token = { count }
