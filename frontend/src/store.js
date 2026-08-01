/*
工作台全局数据：完整展开页面、工作区、会话和设置需要的响应式事实。
本文件只定义数据；组件负责触发，commands 负责修改，Vue 负责反馈。
调用示例：store.ui.view、store.workspaces、store.sessions[sessionID]。
*/
import { reactive } from 'vue'                                      // 引入唯一响应式数据根

const now = Date.now()                                               // 演示数据共享稳定的当前时间
const hour = 60 * 60 * 1000                                         // 时间分组使用的一小时毫秒数


// --- 创建一条展示消息 ---
function message(id, role, content, createdAt, extra = {}) {
  return { id, role, content, createdAt, ...extra }                   // 使用同一字段结构驱动消息与跳转地图
}


// --- 创建完整演示会话 ---
function createDemoSession() {
  return {
    id: 'session-main',                                              // Session 唯一身份
    title: '重构 Agent 运行引擎',                                    // 顶栏和列表展示标题
    provider: 'Aker',                                                // 当前 Session 独立供应商
    model: 'kimi-k2.6',                                              // 当前 Session 独立模型
    prompt: '你是一个可靠、直接、能够自主完成任务的通用 Agent。',       // 当前 Session 系统提示词
    permissions: { read_file: 'allow', write_file: 'ask', run_command: 'ask' }, // 当前 Session 工具权限
    contextTokens: 68240,                                            // 上下文圆环已使用 Token
    contextLimit: 128000,                                            // 上下文圆环总 Token
    inputTokens: 59430,                                              // 当前会话累计输入
    outputTokens: 8810,                                              // 当前会话累计输出
    cacheTokens: 24700,                                              // 当前会话累计缓存读取
    status: 'idle',                                                  // idle 或 running
    draft: '',                                                       // 输入框未发送草稿
    files: [],                                                       // 输入框待发送附件
    rollback: null,                                                  // 暂存回退内容用于撤销
    tasks: [                                                         // 当前任务面板
      { id: 'task-1', content: '梳理 Session 中心的数据模型', status: 'completed', priority: 'high' },
      { id: 'task-2', content: '重构前端信息架构与本地状态', status: 'in_progress', priority: 'high' },
      { id: 'task-3', content: '接入新的 Session API', status: 'pending', priority: 'medium' },
    ],
    messages: [                                                      // 用户可见的完整消息时间线
      message('message-1', 'user', '把 Agent 工作台调整成以 Session 为中心的运行引擎，先梳理清楚前端交互。', now - 4 * hour),
      message('message-2', 'assistant', '已经完成第一轮梳理。核心关系应该保持简单：\n\n- **Workspace** 组织会话\n- **Session** 保存模型、权限与历史\n- **Tool** 只是执行能力\n\n前端会先使用本地状态完成全部交互，后续 Command 直接替换为 API 请求。', now - 4 * hour + 90000, {
        reasoning: '先确认用户真正操作的页面，再反推数据，而不是从后端实体拼界面。',
        tools: [
          {
            id: 'call-read', name: 'read_file', title: '读取前端结构', status: 'completed', checkpoint: 1,
            input: { path: 'README/13-frontend-design.md' }, preview: '已读取页面层级与显示隐藏规则。',
          },
          {
            id: 'call-write', name: 'write_file', title: '更新工作台布局', status: 'waiting', checkpoint: 2,
            input: { path: 'frontend/src/App.vue' }, preview: '等待确认后写入新的侧边栏与页面壳层。', decision: null,
          },
        ],
        request: { status: 'completed', input: 12480, output: 2180, cache: 9300, duration: 8.4 },
      }),
      message('message-3', 'user', '界面要保持黑白、紧凑、即时响应，不要做成营销页。', now - 2 * hour),
      message('message-4', 'assistant', '收到。主页会直接呈现工作区和按时间分组的 Session；对话页保持完整阅读列、任务列表、工具审批与快速跳转，不增加说明性装饰。', now - 2 * hour + 40000, {
        request: { status: 'completed', input: 3290, output: 640, cache: 2100, duration: 3.1 },
      }),
    ],
    createdAt: now - 6 * 24 * hour,                                 // Session 创建时间
    updatedAt: now - 2 * hour,                                     // Session 最近更新时间
  }
}

const demoSession = createDemoSession()                              // 工作区摘要和完整会话使用同一身份


// --- 工作台唯一数据根 ---
export const store = reactive({
  ui: {
    view: 'home',                                                    // home、chat 或 settings
    sidebarOpen: true,                                               // 控制侧边栏文本和历史显隐
    activeWorkspaceID: 'workspace-agent',                            // 主页左侧当前工作区
    activeSessionID: '',                                             // 对话页当前 Session
    settingsSection: 'providers',                                    // 设置页当前分类
    search: '',                                                      // 主页搜索文本
    toast: '',                                                       // 短时全局反馈
  },

  workspaces: [                                                      // 对应 workspace.json 的完整目录
    {
      id: 'workspace-agent', name: 'Agent Engine', path: 'D:/kernyr/agent', createdAt: now - 20 * 24 * hour, updatedAt: now - hour,
      sessions: [
        { id: demoSession.id, title: demoSession.title, model: demoSession.model, messageCount: demoSession.messages.length, createdAt: demoSession.createdAt, updatedAt: demoSession.updatedAt },
        { id: 'session-api', title: '整理 Session API', model: 'gpt-5', messageCount: 18, createdAt: now - 3 * 24 * hour, updatedAt: now - 26 * hour },
        { id: 'session-storage', title: '研究会话存储', model: 'kimi-k2.6', messageCount: 27, createdAt: now - 8 * 24 * hour, updatedAt: now - 9 * 24 * hour },
      ],
    },
    {
      id: 'workspace-notes', name: 'Product Notes', path: 'D:/notes/product', createdAt: now - 14 * 24 * hour, updatedAt: now - 3 * 24 * hour,
      sessions: [
        { id: 'session-roadmap', title: '下一阶段路线图', model: 'gpt-4.1', messageCount: 9, createdAt: now - 5 * 24 * hour, updatedAt: now - 2 * 24 * hour },
      ],
    },
  ],

  sessions: {                                                        // 当前已加载的完整 Session
    [demoSession.id]: demoSession,
    'session-api': { ...createDemoSession(), id: 'session-api', title: '整理 Session API', model: 'gpt-5', messages: [], tasks: [], contextTokens: 12200, updatedAt: now - 26 * hour },
    'session-storage': { ...createDemoSession(), id: 'session-storage', title: '研究会话存储', messages: [], tasks: [], contextTokens: 33500, updatedAt: now - 9 * 24 * hour },
    'session-roadmap': { ...createDemoSession(), id: 'session-roadmap', title: '下一阶段路线图', provider: 'OpenAI', model: 'gpt-4.1', messages: [], tasks: [], contextTokens: 7800, updatedAt: now - 2 * 24 * hour },
  },

  config: {
    providers: {
      Aker: {
        enabled: true, baseURL: 'https://api.aker.example/v1', apiKey: '••••••••••••••••', models: ['kimi-k2.6', 'deepseek-v3.2'],
        modelSettings: { 'kimi-k2.6': { context: 128000, output: 16000, reasoning: true, tools: true } },
        timeout: 120000, headers: '{}',
      },
      OpenAI: {
        enabled: true, baseURL: 'https://api.openai.com/v1', apiKey: '••••••••••••••••', models: ['gpt-5', 'gpt-4.1'],
        modelSettings: { 'gpt-5': { context: 400000, output: 32000, reasoning: true, tools: true } },
        timeout: 120000, headers: '{}',
      },
      Local: {
        enabled: false, baseURL: 'http://127.0.0.1:11434/v1', apiKey: '', models: ['qwen3:8b'], modelSettings: {}, timeout: 60000, headers: '{}',
      },
    },
    tools: [
      { name: 'read_file', title: '读取文件', source: '内置', enabled: true, permission: 'allow' },
      { name: 'write_file', title: '写入文件', source: '内置', enabled: true, permission: 'ask' },
      { name: 'run_command', title: '执行命令', source: '内置', enabled: true, permission: 'ask' },
      { name: 'web_fetch', title: '读取网页', source: '内置', enabled: true, permission: 'allow' },
      { name: 'delegate_task', title: '委派任务', source: '内置', enabled: true, permission: 'allow' },
    ],
    mcp: [
      { id: 'mcp-files', name: 'Local Files', command: 'npx @modelcontextprotocol/server-filesystem', enabled: true, status: 'connected', toolCount: 8 },
      { id: 'mcp-browser', name: 'Browser', command: 'npx browser-mcp', enabled: false, status: 'stopped', toolCount: 5 },
    ],
    prompt: '你是一个可靠、直接、能够自主完成任务的通用 Agent。',
    appearance: { language: 'zh-CN', density: 'comfortable', animations: true },
  },

  settings: {
    draft: null,                                                     // 进入设置后创建的隔离草稿
    savedAt: null,                                                   // 离开设置页后的自动保存时间
    feedback: '',                                                    // 数据导入导出等本地反馈
  },
})
