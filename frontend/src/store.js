/*
工作台数据：集中定义界面、标签、会话、对话、配置和外部能力的完整响应式结构。
本文件只暴露数据及默认值；所有读取、校验和修改仍由 commands 下对应主体的指令执行。
调用示例：const chatStore = useChatStore()、createConversationData()。
*/
import { reactive, ref } from 'vue'                              // 引入工作台字段需要的响应式容器
import { defineStore } from 'pinia'                              // 引入各业务数据仓库的定义能力


// --- 界面数据 ---
export const useUIStore = defineStore('ui', () => {              // 暴露主页和设置导航数据
  const activeView = ref('home')                                 // 当前主区域：home、chat 或 settings
  const settingsSection = ref('models')                          // 当前设置分类：模型、Agent、权限或外部能力

  return { activeView, settingsSection }                         // 只暴露界面数据，不附带修改动作
})


// --- 会话标签数据 ---
export const useTabStore = defineStore('tabs', () => {           // 暴露顶部标签顺序和当前身份
  const tabs = ref([])                                           // 已打开标签，元素包含 key、sessionID 和 title
  const activeKey = ref('')                                      // 当前聊天页对应的标签 key

  return { tabs, activeKey }                                     // 只暴露标签数据，不附带修改动作
})


// --- Server 会话数据 ---
export const useSessionStore = defineStore('session', () => {    // 暴露会话摘要和请求反馈
  const sessions = ref([])                                       // 按更新时间倒序排列的会话摘要
  const isLoading = ref(false)                                   // 会话列表或详情是否正在读取
  const errorMessage = ref('')                                   // 最近一次会话请求的错误说明

  return { sessions, isLoading, errorMessage }                   // 只暴露会话数据，不附带修改动作
})


// --- 创建默认对话数据 ---
export function createConversationData() {
  return {
    sessionID: '',                                               // Server 会话 ID，草稿首次发送后补齐
    messages: [],                                                // 用户、助手和工具组成的展示时间线
    approvals: [],                                               // 正在等待用户决定的工具调用
    tasks: [],                                                   // 当前会话任务清单
    taskRevision: 0,                                             // 任务并发更新修订号
    rollback: null,                                              // 暂存回退摘要，控制撤销反馈
    draftText: '',                                               // 切换标签后仍保留的输入内容
    isRunning: false,                                            // 当前标签 Agent 是否正在运行
    retryNotice: null,                                           // 当前标签连接重试信息
    errorMessage: '',                                            // 当前标签不可恢复错误
    stopSignal: null,                                            // 当前标签 SSE 的本地中断信号
    loaded: false,                                               // 当前标签是否已经读取过会话详情
  }
}


// --- 对话数据 ---
export const useChatStore = defineStore('chat', () => {          // 暴露每个标签独立拥有的对话数据
  const conversations = reactive({})                             // 标签 key 到独立对话数据的映射

  return { conversations }                                      // 只暴露对话数据，不附带修改动作
})


// --- 运行配置数据 ---
export const useConfigStore = defineStore('config', () => {      // 暴露脱敏配置和保存反馈
  const config = ref(null)                                       // Server 返回的脱敏完整配置
  const isLoading = ref(false)                                   // 配置是否正在读取或保存
  const isSaved = ref(false)                                     // 最近一次保存是否成功
  const errorMessage = ref('')                                   // 最近一次配置请求的错误说明

  return { config, isLoading, isSaved, errorMessage }            // 只暴露配置数据，不附带修改动作
})


// --- 外部能力数据 ---
export const useCapabilityStore = defineStore('capabilities', () => { // 暴露 MCP、LSP、Skills 和工具运行快照
  const snapshot = ref({ tools: [], mcp: [], lsp: [], skills: [], skillErrors: [] }) // Server 当前能力目录
  const draft = ref(null)                                        // MCP、LSP 与 Skills 的未保存编辑副本
  const isLoading = ref(false)                                   // 能力是否正在读取或重建
  const isSaving = ref(false)                                    // 能力声明是否正在保存和应用
  const feedback = ref('')                                       // 最近一次成功动作的页面反馈
  const errorMessage = ref('')                                   // 最近一次能力请求的错误说明

  return { snapshot, draft, isLoading, isSaving, feedback, errorMessage } // 只暴露能力数据，不附带修改动作
})
