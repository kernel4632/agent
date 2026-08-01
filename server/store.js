/*
服务端唯一运行时状态仓库。
配置、工具、外部能力和会话都属于同一个进程级状态根，按领域分组避免散落多个入口。
调用示例：store.config.value、store.tools.items.get('task_done')。
*/

export const store = {
  agents: {
    definitions: new Map(),                             // Agent ID 到模型选择和提示词定义
  },
  config: {
    value: null,
    sourceValue: null,                                  // 保留磁盘中的环境占位符，避免保存时写回真实密钥
    filePath: '',
    mcpSourceValue: null,                               // 保留 mcp.json 中的环境占位符
    mcpFilePath: '',                                    // 独立 MCP 配置文件位置
  },
  workspaces: {
    items: new Map(),                                  // Workspace ID 到可持久化工作区定义
    filePath: '',                                      // workspace.json 的真实磁盘位置
  },
  tools: {
    items: new Map(),
    watcher: null,
    directories: [],
  },
  capabilities: {
    mcp: new Map(),
    lsp: new Map(),
    skills: new Map(),
    skillErrors: [],
    workspaceDirectory: '',
    dataDirectory: '',
  },
  sessions: {
    items: new Map(),
    writes: new Map(),
    storage: null,
  },
  events: {
    bySession: new Map(),                              // Session ID 到有序事件历史
    listeners: new Map(),                              // Session ID 到当前 SSE 订阅者集合
    nextID: new Map(),                                 // Session ID 到下一个递增事件 ID
  },
  runs: {
    items: new Map(),                                   // Run ID 到执行状态和取消控制器
    bySession: new Map(),                               // Session ID 到根 Run 集合
    byParent: new Map(),                                // 父 Run ID 到子 Run 集合
  },
}
