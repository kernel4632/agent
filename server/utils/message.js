/*
消息工厂：生成符合 AI SDK 格式的会话消息和工具结果，统一 ID 和结构。
调用示例：Message.user('分析代码')、Message.assistant(blocks)、Message.tool(results)、Message.result(toolCall, output, isError)。
*/
import { nanoid } from 'nanoid'                         // 引入消息唯一 ID 生成能力


// --- 生成消息唯一 ID ---
function id() {
  return `message-${nanoid(12)}`
}


// --- 创建用户消息 ---
function user(content) {
  return { id: id(), role: 'user', content: [{ type: 'text', text: content }] }
}


// --- 创建助手消息 ---
function assistant(contentBlocks) {
  return { id: id(), role: 'assistant', content: contentBlocks }
}


// --- 创建工具结果消息 ---
function tool(results) {
  return { id: id(), role: 'tool', content: results }
}


// --- 创建单个工具结果 ---
function result(toolCall, output, isError) {
  if (!isError && output?.image && output?.mime) return { type: 'tool-result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output: { type: 'image', value: output.image, mimeType: output.mime } }
  const outputType = isError ? (typeof output === 'string' ? 'error-text' : 'error-json') : (typeof output === 'string' ? 'text' : 'json')
  return { type: 'tool-result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output: { type: outputType, value: output } }
}


export const Message = { id, user, assistant, tool, result }
