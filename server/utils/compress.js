/*
上下文压缩工具：估算历史大小，并在超出模型空间时保留头尾、裁掉较早的中段消息。
压缩只返回发送给模型的副本，不修改会话展示与磁盘中的完整消息。
调用示例：compressMessages(modelMessages, 200000)。
*/

// --- 估算消息 token 数量 ---
function estimateTokens(messages) {
  const characters = JSON.stringify(messages).length       // 将结构字段和正文一并纳入保守估算
  return Math.ceil(characters / 2)                          // 中英混合按每 token 两字符估算
}


// --- 裁剪超限历史 ---
export function compressMessages(messages, contextLimit) {
  const allowedTokens = Math.floor(contextLimit * 0.8)      // 为系统指令、工具定义和输出预留 20% 空间
  if (estimateTokens(messages) <= allowedTokens) {          // 未达到阈值时保持完整上下文
    return structuredClone(messages)
  }

  const head = messages.slice(0, 4)                         // 保留最初需求和早期关键约束
  const tail = messages.slice(-10)                          // 保留最近行动和当前任务状态
  const middle = messages.slice(4, -10)                     // 只从较旧的中段开始裁剪
  while (middle.length && estimateTokens([...head, ...middle, ...tail]) > allowedTokens) {
    middle.shift()                                          // 每次移除当前最旧的中段消息
  }
  return [...head, ...middle, ...tail]                      // 返回不影响原会话的模型消息列表
}
