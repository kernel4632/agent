/*
能力运行仓库：集中保存 MCP 连接、LSP 进程和已发现 Skill 的瞬时状态。
配置仍由 Config 持久化；这里的数据随进程退出释放，避免把连接对象写入磁盘。
调用示例：capabilityStore.mcp.get('filesystem')、capabilityStore.skills.get('review')。
*/

// --- 保存外部能力运行状态 ---
export const capabilityStore = {
  mcp: new Map(),                                      // MCP 服务名到客户端、连接状态和工具数量
  lsp: new Map(),                                      // LSP 服务名到子进程、JSON-RPC 连接和诊断缓存
  skills: new Map(),                                   // Skill 名称到元数据、正文路径和校验结果
  skillErrors: [],                                     // 最近一次 Skill 扫描发现的无效目录
  workspaceDirectory: '',                              // LSP 与项目 Skill 共用的工作区根目录
  dataDirectory: '',                                   // 用户 Skill 默认目录的根位置
}
