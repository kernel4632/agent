/*
消息格式工具：创建持久化消息、实时事件和 LLM 上下文。
本文件只转换传入数据，不读取 store、不修改会话，也不发送事件。
调用示例：const message = createUserMessage(id, '分析项目')。
*/


// --- 创建用户消息 ---
export function createUserMessage(id, text) {
  return {
    id,                                                   // 使用调用方生成的消息身份
    role: 'user',                                         // 标记消息来自用户
    content: [{ type: 'text', text: { text } }],          // 按 store 格式保存原始正文
  }
}


// --- 创建助手消息 ---
export function createAssistantMessage(id, blocks) {
  return {
    id,                                                   // 沿用流式反馈使用的消息身份
    role: 'assistant',                                    // 标记消息来自 LLM
    content: blocks.map((block) => {
      if (block.type === 'text') return { type: 'text', text: { text: block.text } } // 文本转成 store 内容块
      if (block.type === 'thinking') return { type: 'thinking', thinking: { thinking: block.thinking } } // 思考转成 store 内容块
      return { type: 'tool_call', toolCallId: block.toolCallId, toolName: block.toolName, input: block.input, status: block.status } // 保留完整工具调用
    }),
  }
}


// --- 创建工具消息 ---
export function createToolMessage(id, results) {
  return { id, role: 'tool', content: results }           // 同轮工具结果组成一条观察消息
}


// --- 创建工具结果 ---
export function createToolResult(toolCall, output, isError) {
  return { type: 'tool_result', toolCallId: toolCall.toolCallId, output, isError } // 结果通过调用身份匹配原工具请求
}


// --- 创建 Agent 实时事件 ---
export function createAgentEvent(messageId, type, data) {
  if (type === 'text-delta') return { name: 'text-delta', data: { messageId, text: data.delta } } // 正文增量使用公开 text 字段
  if (type === 'thinking-delta') return { name: 'thinking-delta', data: { messageId, thinking: data.delta } } // 思考增量使用公开 thinking 字段
  if (type === 'tool-call-ready') {
    const toolCall = { type: 'tool_call', toolCallId: data.toolCallId, toolName: data.toolName, input: data.input, status: 'pending' } // 完整参数到达后创建公开工具调用
    return { name: 'tool-call', data: { messageId, toolCall } } // 工具事件和其他流事件共享消息身份
  }
  return null                                             // 起始和参数碎片事件当前不需要对外发送
}


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
