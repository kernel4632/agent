/*
工作台数据：集中定义界面、标签、会话、对话、配置和外部能力的完整响应式结构。
本文件只暴露数据及默认值；所有读取、校验和修改仍由 commands 下对应主体的指令执行。
调用示例：store.chat.conversations、store.config.current。
*/
import { reactive } from 'vue'                                    // 引入单一全局响应式状态容器


// --- 创建默认对话数据 ---
export function createConversationData() {
  return {
    sessionID: '',                                               // Server 会话 ID，草稿首次发送后补齐
    agentID: '',                                                  // 当前会话选择的 Agent 定义
    activeRunID: '',                                              // 当前根 Run，停止动作按它精确定位
    runs: [],                                                      // 当前会话的根 Run 和子 Run 状态
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


// --- 工作台全局数据 ---
export const store = reactive({                                  // 暴露唯一全局数据对象，所有页面共享同一引用
  agents: {                                                       // Server 可选择的 Agent 定义目录
    items: [],                                                    // Agent ID、名称、供应商和模型
    isLoading: false,                                             // Agent 目录是否正在读取
    errorMessage: '',                                             // 最近一次 Agent 目录错误
  },
  ui: {                                                           // 页面导航和设置分类
    activeView: 'home',                                          // 当前主区域：home、chat 或 settings
    settingsSection: 'models',                                   // 当前设置分类：模型、Agent、权限或外部能力
  },
  tabs: {                                                         // 顶部聊天标签和当前选择
    items: [],                                                    // 已打开标签，元素包含 key、sessionID 和 title
    activeKey: '',                                                // 当前聊天页对应的标签 key
  },
  session: {                                                      // Server 会话摘要和请求反馈
    items: [],                                                   // 按更新时间倒序排列的会话摘要
    isLoading: false,                                             // 会话列表或详情是否正在读取
    errorMessage: '',                                             // 最近一次会话请求的错误说明
  },
  chat: {                                                         // 每个标签独立拥有的对话数据
    conversations: {},                                           // 标签 key 到独立对话数据的映射
  },
  config: {                                                       // 脱敏运行配置和保存反馈
    current: null,                                                // Server 返回的脱敏完整配置
    isLoading: false,                                             // 配置是否正在读取或保存
    isSaved: false,                                               // 最近一次保存是否成功
    errorMessage: '',                                             // 最近一次配置请求的错误说明
  },
  capabilities: {                                                 // MCP、LSP、Skills 和工具运行快照
    snapshot: { tools: [], mcp: [], lsp: [], skills: [], skillErrors: [] }, // Server 当前能力目录
    draft: null,                                                  // MCP、LSP 与 Skills 的未保存编辑副本
    isLoading: false,                                             // 能力是否正在读取或重建
    isSaving: false,                                              // 能力声明是否正在保存和应用
    feedback: '',                                                 // 最近一次成功动作的页面反馈
    errorMessage: '',                                             // 最近一次能力请求的错误说明
  },
})
