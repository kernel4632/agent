/*
工作台全局数据：集中保存 Server 返回的工作区、会话、配置和界面状态。
本文件只定义字段结构，不读取网络、不执行业务动作，也不直接操作页面。
调用示例：store.workspaces、store.sessions[sessionID]、store.ui.activeSessionID。
*/
import { reactive } from 'vue'                         // 引入唯一响应式数据根


// --- 从 localStorage 恢复外观偏好 ---
function loadAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem('agent.appearance'))  // 读取上次保存的偏好
    if (saved && typeof saved === 'object') return { theme: saved.theme || 'system' }
  } catch { /* 损坏数据回退默认 */ }
  return { theme: 'system' } // 首次使用的默认值
}


// --- 工作台唯一数据根 ---
export const store = reactive({
  ui: {
    view: 'home',                                      // 当前页面为 home、chat 或 settings
    sidebarOpen: window.innerWidth > 760,              // 760px 是移动端与桌面端的响应式断点，窄屏首次进入时收起侧栏优先展示主内容
    activeWorkspaceID: '',                             // 主页当前工作区身份
    activeSessionID: '',                               // 对话页当前会话身份
    openedSessionIDs: [],                              // 用户本次运行中主动打开的会话，顺序即侧边栏顺序
    settingsSection: 'providers',                      // 设置页当前分类
    search: '',                                        // 主页搜索文本
    toast: '',                                         // 短时全局反馈
    isLoading: true,                                   // 首次 API 数据加载状态
    errorMessage: '',                                  // 最近一次跨页面 API 错误
  },

  workspaces: [],                                      // Server `/workspace` 返回的目录和会话摘要
  sessions: {},                                       // 已读取的完整会话，以 Session ID 为键
  config: {
    providers: {},                                    // 设置页可编辑供应商目录
    tools: [],                                        // 工具运行目录与权限
    mcp: [],                                          // MCP 编辑目录与运行状态
    prompt: '',                                       // 全局系统提示词
    appearance: loadAppearance(),                       // 从 localStorage 恢复外观偏好
    activeProvider: '',                               // Server 当前供应商
    activeModel: '',                                  // Server 当前模型
    raw: null,                                        // 脱敏后的完整 Server 配置
  },

  events: {
    lastIDs: {},                                      // 每个会话最后处理的递增 SSE ID
    controllers: {},                                  // 每个会话当前订阅的中断控制器
  },

  tabs: {
    items: [],                                        // 顶部标签列表，每项包含 key、sessionID、title
    activeKey: '',                                    // 当前选中标签的稳定键名
  },

  settings: {
    draft: null,                                      // 进入设置后创建的隔离草稿
    savedAt: null,                                    // 最近成功自动保存时间
    isSaving: false,                                  // 离开设置时的 API 保存状态
  },
})
