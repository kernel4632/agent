/*
能力指令：负责 MCP、LSP、Skills 的运行快照、配置草稿和保存重建动作。
运行数据写入 store.js；Vue 组件只展示数据并把用户事件交给本指令。
调用示例：await Capability.load()、Capability.addMCP(draft)、await Capability.save(draft)。
*/
import { AgentAPI } from '../api.js'                              // 引入能力和配置 HTTP 指令
import { store } from '../store.js'                                // 引入全局能力运行数据结构


// --- 复制 JSON 数据 ---
function clone(value) {
  return JSON.parse(JSON.stringify(value))                         // API 配置只含 JSON 值，可安全创建独立草稿
}


// --- 创建可编辑能力草稿 ---
function createDraft(config) {
  const draft = clone(config)                                      // 保留 API 返回配置不受表单修改影响
  for (const server of Object.values(draft.mcpServers || {})) {
    server._envRows = Object.entries(server.env || {}).map(([key, value]) => ({ key, value })) // 环境变量映射转换为稳定表单行
    server._headersRows = Object.entries(server.headers || {}).map(([key, value]) => ({ key, value })) // 请求头映射使用独立表单行
    delete server._headerRows                                      // 清理早期草稿误写的单数私有字段
  }
  for (const server of Object.values(draft.lspServers || {})) server._envRows = Object.entries(server.env || {}).map(([key, value]) => ({ key, value })) // LSP 环境变量同构处理
  return draft                                                     // 返回只供设置页修改的草稿
}


// --- 还原服务配置映射 ---
function serializeServers(servers) {
  const serialized = clone(servers || {})                          // 使用副本避免删除页面仍需的表单字段
  for (const server of Object.values(serialized)) {
    for (const field of ['env', 'headers']) {
      const rows = server[`_${field}Rows`]                          // 读取当前字段对应的表单行
      if (rows) server[field] = Object.fromEntries(rows.map((row) => [row.key.trim(), row.value]).filter(([key]) => key)) // 忽略未填写键名的新增行
      delete server[`_${field}Rows`]                                // 私有表单结构不写入用户配置
    }
    delete server._headerRows                                      // 清理早期页面产生的私有字段
  }
  return serialized                                                // 返回 Server 声明格式
}


// --- 读取当前能力快照 ---
async function load() {
  const capabilityStore = store.capabilities                         // 读取能力运行数据和反馈字段
  capabilityStore.isLoading = true                                 // 顶部和设置页进入加载状态
  capabilityStore.errorMessage = ''                                // 新请求清理旧错误
  try {
    capabilityStore.snapshot = await AgentAPI.listCapabilities()  // 用 Server 最终运行快照替换旧数据
    return capabilityStore.snapshot                                // 返回快照供组合指令继续使用
  } catch (error) {
    capabilityStore.errorMessage = error.message                   // 保存网络或 Server 错误
    throw error                                                    // 入口需要知道加载失败
  } finally {
    capabilityStore.isLoading = false                              // 恢复能力动作
  }
}


// --- 读取运行态和配置草稿 ---
async function loadSettings() {
  const capabilityStore = store.capabilities                         // 读取能力草稿数据
  const [, config] = await Promise.all([load(), AgentAPI.getConfig()]) // 并行读取运行态和声明配置
  capabilityStore.draft = createDraft(config)                      // 写入可编辑能力草稿
}


// --- 重建全部外部能力 ---
async function reload() {
  const capabilityStore = store.capabilities                         // 读取能力运行数据和反馈字段
  capabilityStore.isLoading = true                                 // 重连期间锁定重复动作
  capabilityStore.feedback = ''                                    // 新动作清理旧成功反馈
  capabilityStore.errorMessage = ''                                // 清理旧连接错误
  try {
    await AgentAPI.reloadCapabilities()                            // 关闭旧连接并重新发现能力
    capabilityStore.snapshot = await AgentAPI.listCapabilities()  // 获取重建后的真实状态
    capabilityStore.feedback = '能力已重载'                        // 反馈完整重建生命周期完成
    return capabilityStore.snapshot                                // 返回最终快照供入口反馈
  } catch (error) {
    capabilityStore.errorMessage = error.message                   // 保存真实重连错误
    throw error                                                    // 保存流程需要知道重连失败
  } finally {
    capabilityStore.isLoading = false                              // 恢复能力动作
  }
}


// --- 保存能力声明并重建连接 ---
async function save() {
  const capabilityStore = store.capabilities                         // 读取能力草稿和保存反馈
  if (!capabilityStore.draft) return false                         // 草稿尚未加载时拒绝空保存
  capabilityStore.isSaving = true                                  // 保存按钮进入进行状态
  capabilityStore.feedback = ''                                    // 新保存清理旧成功反馈
  capabilityStore.errorMessage = ''                                // 新保存清理旧错误
  try {
  await AgentAPI.updateConfig({                                    // 只提交能力页面负责的配置字段
    mcpServers: serializeServers(capabilityStore.draft.mcpServers), // 保存 MCP 完整声明
    lspServers: serializeServers(capabilityStore.draft.lspServers), // 保存 LSP 完整声明
    skills: capabilityStore.draft.skills || { enabled: true, directories: [], disabled: [] }, // 保存 Skills 扫描和开关
  })
  await reload()                                                   // 声明落盘后重建真实运行能力
  capabilityStore.draft = createDraft(await AgentAPI.getConfig())  // 写入 Server 规范化后的新草稿
  capabilityStore.feedback = '配置已保存，运行能力已更新'          // 反馈保存和重建均完成
  return true                                                      // 返回保存动作完成
  } catch (error) {
    capabilityStore.errorMessage = error.message                   // 保留草稿并显示失败原因
    return false                                                   // 返回保存没有完成
  } finally {
    capabilityStore.isSaving = false                               // 恢复保存动作
  }
}


// --- 创建未占用名称 ---
function getUniqueName(prefix, collection) {
  let index = 1                                                    // 名称从易读的 1 开始
  while (`${prefix}-${index}` in collection) index += 1            // 跳过已经占用的名称
  return `${prefix}-${index}`                                      // 返回可直接保存的配置键
}


// --- 新增一个 MCP 服务 ---
function addMCP(activeSection) {
  const draft = store.capabilities.draft                            // 读取当前能力草稿
  if (!draft) return ''                                            // 草稿尚未加载时不能新增服务
  const name = getUniqueName('mcp', draft.mcpServers || {})        // 创建不覆盖现有服务的名称
  draft.mcpServers[name] = { enabled: true, transport: 'stdio', command: '', args: [], cwd: '', env: {}, headers: {}, _envRows: [], _headersRows: [] } // 写入完整 stdio 默认声明
  if (activeSection) selectSection(activeSection, 'mcp')           // 保持页面位于新增服务分类
  return name                                                      // 返回名称供页面定位新增项
}


// --- 新增一个 LSP 服务 ---
function addLSP(activeSection) {
  const draft = store.capabilities.draft                            // 读取当前能力草稿
  if (!draft) return ''                                            // 草稿尚未加载时不能新增服务
  const name = getUniqueName('language-server', draft.lspServers || {}) // 创建不覆盖现有服务的名称
  draft.lspServers[name] = { enabled: true, command: '', args: [], root: '', languageId: '', extensions: [], env: {}, _envRows: [] } // 写入完整语言服务声明
  if (activeSection) selectSection(activeSection, 'lsp')           // 保持页面位于新增服务分类
  return name                                                      // 返回名称供页面定位新增项
}


// --- 重命名一个服务 ---
function renameServer(collectionName, oldName, nextName) {
  const draft = store.capabilities.draft                            // 读取当前能力草稿
  if (!draft) return false                                         // 草稿尚未加载时不能重命名
  const name = nextName.trim()                                     // 服务身份不保留首尾空白
  const collection = draft[collectionName]                         // 读取目标配置集合
  if (!name || name === oldName || collection[name]) return false // 空名称、未变化或冲突时保持原键
  collection[name] = collection[oldName]                           // 先复制完整声明到新身份
  delete collection[oldName]                                      // 再移除旧身份完成重命名
  return true                                                      // 返回草稿已修改
}


// --- 删除一个服务 ---
function removeServer(collectionName, name) {
  const draft = store.capabilities.draft                            // 读取当前能力草稿
  if (!draft) return                                               // 草稿尚未加载时不能删除
  delete draft[collectionName][name]                               // 完整集合保存时会真实关闭并移除服务
}


// --- 修改多行列表字段 ---
function setLines(target, field, value) {
  target[field] = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) // 每行转换为一个参数或扩展名
}


// --- 修改逗号分隔列表字段 ---
function setCommaList(target, field, value) {
  target[field] = value.split(',').map((item) => item.trim()).filter(Boolean) // 将逗号文本转换为规范字符串清单
}


// --- 新增一个键值表单行 ---
function addPair(target, field) {
  target[`_${field}Rows`].push({ key: '', value: '' })              // 空行等待用户填写键名和值
}


// --- 新增一个 Skill 根目录 ---
function addSkillDirectory() {
  const draft = store.capabilities.draft                            // 读取当前能力草稿
  if (!draft) return                                               // 草稿尚未加载时不能新增目录
  draft.skills.directories.push('')                                // 新增空目录行等待用户输入
}


// --- 修改一个 Skill 的启用状态 ---
function setSkillEnabled(name, enabled) {
  const draft = store.capabilities.draft                            // 读取当前能力草稿
  if (!draft) return                                               // 草稿尚未加载时不能修改技能
  const disabled = new Set(draft.skills.disabled || [])            // 用集合避免重复禁用名称
  if (enabled) disabled.delete(name)                               // 启用时移出禁用清单
  else disabled.add(name)                                         // 停用时加入禁用清单
  draft.skills.disabled = [...disabled]                            // 写回可持久化数组
}


// --- 读取一个服务的运行状态 ---
function getServerState(kind, name) {
  const snapshot = store.capabilities.snapshot                      // 读取当前 Server 能力快照
  return snapshot[kind]?.find((item) => item.name === name) || { status: 'unsaved', error: '', toolCount: 0 } // 新草稿显示未保存
}


// --- 切换能力页面分类 ---
function selectSection(activeSection, section) {
  activeSection.value = section                                    // 将能力页面切换到用户选择的分类
}


// --- 修改一个草稿字段 ---
function setValue(target, field, value) {
  target[field] = value                                           // 将表单值写入对应能力声明字段
}


// --- 修改一个键值表单单元格 ---
function setPairValue(row, field, value) {
  row[field] = value                                              // 将键名或值写入当前稳定表单行
}


// --- 删除一个键值表单行 ---
function removePair(target, field, index) {
  target[`_${field}Rows`].splice(index, 1)                         // 从当前环境变量或请求头草稿移除目标行
}


// --- 修改 Skills 总开关 ---
function setSkillsEnabled(enabled) {
  const draft = store.capabilities.draft                            // 读取当前能力草稿
  if (!draft) return                                               // 草稿尚未加载时不能修改开关
  draft.skills.enabled = enabled                                  // 写入 Skills 全局启用状态
}


// --- 修改一个 Skill 目录 ---
function setSkillDirectory(index, directory) {
  const draft = store.capabilities.draft                            // 读取当前能力草稿
  if (!draft) return                                               // 草稿尚未加载时不能修改目录
  draft.skills.directories[index] = directory                     // 写入目标目录草稿
}


// --- 删除一个 Skill 目录 ---
function removeSkillDirectory(index) {
  const draft = store.capabilities.draft                            // 读取当前能力草稿
  if (!draft) return                                               // 草稿尚未加载时不能删除目录
  draft.skills.directories.splice(index, 1)                       // 从扫描目录清单移除目标项
}


export const Capability = { load, loadSettings, reload, save, addMCP, addLSP, renameServer, removeServer, setLines, setCommaList, addPair, removePair, setValue, setPairValue, addSkillDirectory, setSkillDirectory, removeSkillDirectory, setSkillsEnabled, setSkillEnabled, getServerState, selectSection } // 暴露全部能力指令
