/*
消息转换工具：把持久化会话消息转换成 LLM 可以接收的消息格式。
本文件只处理传入数据，不读取 store、不修改会话，也不发送任何事件。
调用示例：const messages = createLLMMessages(session.messages)。
*/

// --- 创建 LLM 消息 ---
export function createLLMMessages(messages) {
  return messages.map((message, messageIndex) => {
    if (message.role === 'user') return { role: 'user', content: message.content.filter((block) => block.type === 'text').map((block) => ({ type: 'text', text: block.text.text })) } // 用户消息只发送文本
    if (message.role === 'assistant') return { role: 'assistant', content: message.content.flatMap((block) => {
      if (block.type === 'text') return [{ type: 'text', text: block.text.text }] // 助手文本直接还原
      if (block.type === 'tool_call') return [{ type: 'tool-call', toolCallId: block.toolCallId, toolName: block.toolName, input: block.input }] // 工具调用恢复 LLM 格式
      return []                                          // 思考内容不重新发送给模型
    }) }

    const content = message.content.filter((block) => block.type === 'tool_result').map((block) => {
      let toolName = 'unknown_tool'                      // 损坏历史使用稳定占位名
      for (let index = messageIndex - 1; index >= 0; index -= 1) {
        const call = messages[index].content.find((item) => item.type === 'tool_call' && item.toolCallId === block.toolCallId) // 从最近消息向前匹配工具调用
        if (call) { toolName = call.toolName; break }    // 找到后使用原始工具名
      }
      const value = typeof block.output === 'string' ? block.output : JSON.stringify(block.output) // 对象输出用 JSON 保留结构
      return { type: 'tool-result', toolCallId: block.toolCallId, toolName, output: { type: block.isError ? 'error-text' : 'text', value } } // 恢复 LLM 工具结果
    })
    return { role: 'tool', content }                     // 返回完整工具观察消息
  })
}
