/*
界面翻译：当前只提供简体中文，统一从这里取文案，避免页面各写一份。
业务数据保持原文；只有应用命令、标签、说明和无障碍文本经过这里。
调用示例：t('copied')、t('sessionCount', { count: 5 })、formatDateTime(Date.now())。
*/

const messages = {                                                    // 全部界面文案按语言分组
  'zh-CN': {
    home: '主页', newChat: '新建对话', sessions: '会话', settings: '设置', mainNav: '主要导航', agentHome: 'Agent 主页',
    search: '搜索工作区或会话', workspace: '工作区', addWorkspace: '添加工作区', noWorkspace: '没有匹配的工作区',
    sessionCount: '{count} 个会话', today: '今天', yesterday: '昨天', earlier: '更早', messageCount: '{count} 条消息',
    noMatchingSessions: '没有匹配的会话', noSessions: '这个工作区还没有会话', name: '名称', path: '路径',
    workspaceNameExample: '例如 Agent Engine', workspacePathExample: 'D:/projects/app', add: '添加', cancel: '取消', close: '关闭',
    workspaceDescription: '登记一个 Agent 可以操作的本地目录', sessionTitle: '会话标题', renameSession: '重命名会话', rename: '重命名',
    deleteSession: '删除会话', delete: '删除', deleteSessionDescription: '“{title}”的历史将被移除。', unnamedSession: '未命名会话',
    doubleClickRename: '双击重命名', doubleClickRenameSession: '双击重命名会话',
    contextStats: '上下文统计', context: '上下文', used: '已使用', limit: '上限', ratio: '占比', startTask: '从一个任务开始',
    quickJump: '对话快速跳转', previousMessage: '上一个消息', nextMessage: '下一个消息', jumpUser: '跳转到用户消息', jumpAssistant: '跳转到助手消息',
    rolledBack: '已回退', undoRollback: '取消回退', rollbackTool: '回退到工具步骤', rollbackDescription: '步骤 {step} 之后的消息会暂时隐藏，可以随时取消回退。', confirmRollback: '确认回退',
    message: '消息', messagePlaceholder: '给 Agent 一个任务', uploadFile: '上传文件', removeFile: '移除 {name}', switchModel: '切换模型', pauseGeneration: '暂停生成', send: '发送',
    recallEdit: '撤回并编辑消息', recallEditTitle: '撤回并编辑', copyMessage: '复制消息', copy: '复制', apiRequest: 'API 请求', receiving: '正在接收响应', paused: '已暂停', inputTokens: '输入 {count}', outputTokens: '输出 {count}', cacheTokens: '缓存 {count}',
    waiting: '等待确认', running: '执行中', completed: '已完成', rejected: '已拒绝', rollbackHere: '回退到这里', collapseTool: '收起工具详情', expandTool: '展开工具详情', input: '输入', deny: '拒绝', allow: '允许', alwaysAllow: '始终允许',
    thinking: '正在思考', reasoning: '思考过程', thinkingPlaceholder: '模型正在组织下一步行动…', copied: '已复制', copyFailed: '复制失败', copyCode: '复制代码',
    toolBlockedReason: '已被忽略规则拦下（{reason}）', mcpFailed: 'MCP 服务 {server} 没连上：{error}',
    providerConfig: '供应商配置', toolManagement: '工具管理', mcpManagement: 'MCP 管理', promptDefinition: '系统提示词定义', appearance: '外观', dataManagement: '数据管理',
    autoSaved: '已自动保存', autoSaveOnLeave: '离开设置页自动保存', draftFeedback: '修改会即时反映在当前草稿中', tools: '工具', toolsDescription: '统一管理内置、自定义和外部工具', toolAlias: '工具易读别名', toolPermission: '工具默认权限', ask: '询问', builtIn: '内置', readFile: '读取文件', writeFile: '写入文件', runCommand: '执行命令', webFetch: '读取网页',
    mcpServices: 'MCP 服务', mcpDescription: '保存后自动重建连接与工具目录', addMcp: '添加 MCP', mcpName: 'MCP 名称', toolCount: '{count} 个工具', deleteMcp: '删除 MCP', launchCommand: '启动命令', noMcp: '还没有 MCP 服务',
    globalPrompt: '全局系统提示词', promptDescription: '系统提示词应用到所有会话；首次使用有默认内容，可以修改或清空', characterCount: '{count} 字符',
     appearanceDescription: '调整动态颜色、对比度、密度与界面动效', 
    dataDescription: '配置、Workspace 和 Session 数据保存在用户目录', dataActionsUnavailable: '数据操作当前不可用', dataActionsUnavailableDescription: '此 Server 未提供数据导入、导出或清理接口。',
    providers: '供应商', addProvider: '添加供应商', providerName: '供应商名', enableProvider: '启用供应商', enableProviderDescription: '允许 Session 选择此服务', apiAddress: '请求地址（API）', modelList: '模型列表', modelListDescription: '供 Session 独立选择的模型', fetchModels: '获取模型列表', reasoningCapability: '推理', toolCapability: '工具', modelSettings: '模型设置', removeModel: '移除模型', noModels: '还没有添加模型', customConfig: '自定义配置', requestTimeout: '请求超时（ms）', customHeaders: '自定义请求头（JSON）', deleteProvider: '删除供应商', selectModel: '选择模型', availableModels: '{provider} 返回的可用模型', allModelsAdded: '所有模型都已添加', done: '完成', modelLimits: '模型能力与生成限制', contextLength: '上下文长度', maxOutput: '最大输出', reasoningFeature: '推理能力', reasoningDescription: '展示模型思考过程', toolFeature: '工具能力', toolDescription: '允许模型调用工具',
    newConversation: '新对话', sessionDeleted: '会话已删除', workspaceAdded: '工作区已添加', workspaceRemoved: '已移除工作区', generationPaused: '已暂停生成', toolDenied: '已拒绝工具调用', toolAllowed: '工具调用已允许', operationDenied: '用户拒绝了这次操作。', operationAllowedAlways: '已执行，并记住这类操作。', operationAllowed: '已执行本次操作。', toolStep: '工具步骤 {step}', newMcp: '新 MCP', exportReady: '导出包已准备', chooseBackup: '请选择备份文件', demoNotCleared: '演示数据未实际清除',
  },
}


// --- 读取当前界面语言 ---
export function currentLanguage() {
  return 'zh-CN'
}


// --- 翻译文案键并替换变量 ---
export function t(key, values = {}) {
  const language = currentLanguage()                                   // 确定当前语言
  const template = messages[language]?.[key] ?? messages['zh-CN'][key] ?? key // 优先当前语言，回退中文，最后返回原键
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template) // 将 {count} 等占位符替换为实参
}


// --- 格式化日期时间 ---
export function formatDateTime(timestamp, options) {
  return new Intl.DateTimeFormat(currentLanguage(), options).format(timestamp) // 使用浏览器国际化按当前语言格式化
}
