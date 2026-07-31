/*
会话数据：定义 Server 会话摘要和请求反馈字段。
本文件只保存数据结构，会话读写统一由 commands/session.js 执行。
调用示例：const sessionStore = useSessionStore()。
*/
import { ref } from 'vue'                               // 引入会话字段需要的响应式容器
import { defineStore } from 'pinia'                     // 引入会话数据仓库定义能力

export const useSessionStore = defineStore('session', () => { // 暴露唯一会话数据结构
  const sessions = ref([])                              // 按更新时间倒序排列的会话摘要
  const isLoading = ref(false)                          // 会话列表或详情是否正在读取
  const errorMessage = ref('')                          // 最近一次会话请求的错误说明

  return { sessions, isLoading, errorMessage }          // 只暴露会话数据，不附带修改动作
})
