/*
消息工厂：生成符合 AI SDK 格式的会话消息，统一 ID 和结构。
业务代码只调用 Message.user / Message.assistant / Message.tool，不手动拼结构。

使用示例
const msg = Message.user('分析这段代码')
const reply = Message.assistant(contentBlocks)
const result = Message.tool(toolResults)
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


export const Message = { id, user, assistant, tool }
