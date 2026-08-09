/*
全局数据中心：定义配置、工作区、会话和运行时四类数据结构。
所有读写和持久化逻辑在 commands 和 features 中，本文件不提供方法。
runtime 使用 Proxy 按需创建——session 存在 runtime 就跟随存在，首次访问自动初始化。
调用示例：store.config.provider.api、store.sessions['session-xxx'].messages、store.runtime['session-xxx'].status。
*/

export const store = {
  paths: {
    sessions: '',                                         // 会话文件目录，启动时设定
    config: '',                                           // 配置文件路径，启动时设定
    workspace: '',                                        // 工作区文件路径，启动时设定
  },
  config: {
    provider: {
      api: '',                                            // 模型 API 地址
      key: '',                                            // 模型 API 密钥
      models: [],                                         // 可用模型列表
      maxTokens: 100000,                                  // 上下文窗口大小，触发压缩的阈值
    },
    prompts: {
      system: '你是一个AI Agent',                         // 系统提示词
      tool: '继续完成用户任务。需要外部操作时必须调用可用工具，不要只描述计划。', // 连续纯文本后的工具提醒
      summary: '将以下对话历史压缩为结构化摘要。保留：用户核心需求、关键决策、文件路径、错误及修复、当前进度。去掉：冗余描述、重复内容、思考过程、大段代码。格式：简短条目列表。语言：与对话相同。', // 摘要压缩提示词
    },
    permission: {},                                       // 工具权限：{ toolName: "allow" | "ask" }，未列出的默认放行
    mcp: {},                                              // MCP 服务器配置：{ serverName: { type, enabled, command?, url?, environment?, headers?, timeout? } }
  },
  workspaces: {},                                         // 工作区 KV：{ [id]: { path, sessions: [{ id, title, lastActiveAt }] } }
  sessions: {},                                           // 会话 KV：{ [id]: { messages, provider, model } }
  tools: {},                                              // 启动时扫描得到的 LLM 工具定义
  runtime: {},                                            // 运行时状态 KV：Session.create/get 时显式创建 { [id]: { status, controller, clients, tools, approvals } }
}
