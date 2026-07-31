/*
对话数据：定义每个顶部标签独立拥有的消息、任务、审批和流状态。
本文件只声明默认会话结构与会话映射，全部读写动作位于 commands/chat.js。
调用示例：const chatStore = useChatStore()、createConversationData()。
*/
import { reactive } from 'vue'                              // 引入按标签组织的响应式数据映射
import { defineStore } from 'pinia'                         // 引入对话数据仓库定义能力


// --- 创建一份默认对话数据 ---
export function createConversationData() {
  return {
    sessionID: '',                                         // Server 会话 ID，草稿首次发送后补齐
    messages: [],                                          // 用户、助手和工具组成的展示时间线
    approvals: [],                                         // 正在等待用户决定的工具调用
    tasks: [],                                             // 当前会话任务清单
    taskRevision: 0,                                       // 任务并发更新修订号
    rollback: null,                                        // 暂存回退摘要，控制撤销反馈
    draftText: '',                                         // 切换标签后仍保留的输入内容
    isRunning: false,                                      // 当前标签 Agent 是否正在运行
    retryNotice: null,                                     // 当前标签连接重试信息
    errorMessage: '',                                      // 当前标签不可恢复错误
    stopSignal: null,                                      // 当前标签 SSE 的本地中断信号
    loaded: false,                                         // 当前标签是否已经读取过会话详情
  }
}


export const useChatStore = defineStore('chat', () => {    // 暴露唯一对话数据结构
  const conversations = reactive({})                       // 标签 key 到独立对话数据的映射

  return { conversations }                                 // 只暴露对话数据，不附带修改动作
})
