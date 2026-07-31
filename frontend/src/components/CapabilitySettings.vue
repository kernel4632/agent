<!--
能力中心：管理 Agent 内置工具、MCP 服务、LSP 服务和渐进披露 Skills。
用户保存声明后触发 Server 重建连接，页面再以真实运行状态替换草稿反馈。
调用示例：Settings 在能力分类中渲染 <CapabilitySettings embedded />。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'                   // 引入能力清单、草稿和首次加载能力
import { storeToRefs } from 'pinia'                              // 保持共享能力快照响应性
import { AgentAPI } from '../api.js'                            // 引入配置与能力生命周期指令
import { useCapabilityStore } from '../stores/capabilities.js'  // 引入顶部与设置页共享运行态

const props = defineProps({ embedded: { type: Boolean, default: false } }) // 设置页嵌入时使用能力优先导航
const capabilityStore = useCapabilityStore()                    // 读取唯一能力运行态
const { snapshot: capabilities } = storeToRefs(capabilityStore) // 保持现有模板读取方式
const activeTab = ref(props.embedded ? 'mcp' : 'tools')          // 设置页首先展示最常管理的 MCP
const draft = ref(null)                                         // MCP、LSP 与 Skill 可编辑配置副本
const isLoading = ref(false)                                    // 首次读取或重载状态
const isSaving = ref(false)                                     // 保存并重连状态
const feedback = ref('')                                        // 最近一次成功反馈
const errorMessage = ref('')                                    // 最近一次失败反馈
const baseTabs = [                                               // 稳定标签顺序支持键盘和测试定位
  { id: 'tools', label: '工具' },
  { id: 'mcp', label: 'MCP' },
  { id: 'lsp', label: 'LSP' },
  { id: 'skills', label: 'Skills' },
]
const tabs = computed(() => props.embedded ? [baseTabs[1], baseTabs[2], baseTabs[3], baseTabs[0]] : baseTabs) // 设置内优先展示外部能力

const toolGroups = computed(() => (capabilities.value.tools || []).reduce((groups, tool) => { const source = tool.kind || tool.source || 'built-in'; (groups[source] ||= []).push(tool); return groups }, {})) // 按来源组织密集工具清单并兼容旧桌面浏览器
const connectedMCP = computed(() => capabilities.value.mcp.filter((item) => item.status === 'connected').length) // 标题展示真实 MCP 可用数
const connectedLSP = computed(() => capabilities.value.lsp.filter((item) => item.status === 'connected').length) // 标题展示真实 LSP 可用数
const enabledSkills = computed(() => capabilities.value.skills.filter((item) => item.enabled).length) // 标题展示注入模型的 Skill 数


// --- 复制 JSON 配置为可编辑草稿 ---
function clone(value) {
  return JSON.parse(JSON.stringify(value))                         // API 配置只含 JSON 值，复制后不污染读取缓存
}


// --- 为键值配置建立稳定的表单行 ---
function editableConfig(config) {
  const value = clone(config)                                      // 保留 API 返回对象不受表单装饰影响
  for (const server of Object.values(value.mcpServers || {})) {
    server._envRows = Object.entries(server.env || {}).map(([key, item]) => ({ key, value: item })) // 环境变量键名可原位编辑
    server._headersRows = Object.entries(server.headers || {}).map(([key, item]) => ({ key, value: item })) // 请求头使用独立草稿
    delete server._headerRows                                      // 清理早期草稿误写入配置的单数键
  }
  for (const server of Object.values(value.lspServers || {})) server._envRows = Object.entries(server.env || {}).map(([key, item]) => ({ key, value: item })) // LSP 环境变量同构处理
  return value                                                     // 返回仅供当前页面使用的草稿
}


// --- 将稳定表单行还原为 Server 配置映射 ---
function serializedServers(servers) {
  const value = clone(servers || {})                               // 序列化副本避免删除页面草稿字段
  for (const server of Object.values(value)) {
    for (const field of ['env', 'headers']) {
      const rows = server[`_${field}Rows`]                          // 只处理当前服务支持的键值字段
      if (rows) server[field] = Object.fromEntries(rows.map((row) => [row.key.trim(), row.value]).filter(([key]) => key)) // 忽略未填写键名的新增行
      delete server[`_${field}Rows`]                                // 私有表单结构不写入用户配置
    }
    delete server._headerRows                                      // 兼容清理早期页面产生的私有草稿键
  }
  return value                                                     // 返回后端声明格式
}


// --- 读取真实能力与配置 ---
async function loadCapabilities() {
  isLoading.value = true                                           // 页面进入统一加载状态
  errorMessage.value = ''                                         // 新请求清理旧错误
  try {
    const [, config] = await Promise.all([capabilityStore.load(), AgentAPI.getConfig()]) // 并行读取运行态和声明
    draft.value = editableConfig(config)                            // 配置草稿保留脱敏占位符和稳定键值行
  } catch (error) {
    errorMessage.value = error.message                             // 原位反馈网络或 Server 错误
  } finally {
    isLoading.value = false                                        // 恢复页面动作
  }
}


// --- 重载当前能力运行态 ---
async function reloadCapabilities() {
  isLoading.value = true                                           // 防止重复重连
  feedback.value = ''                                              // 清理上次成功反馈
  errorMessage.value = ''                                         // 清理上次失败反馈
  try {
    await capabilityStore.reload()                                 // 真实关闭并重建 MCP/LSP/Skills
    feedback.value = '能力已重载'                                  // 反馈完整生命周期完成
  } catch (error) {
    errorMessage.value = error.message                             // 保留当前列表便于排查
  } finally {
    isLoading.value = false                                        // 恢复重载动作
  }
}


// --- 保存外部能力声明并重连 ---
async function saveCapabilities() {
  isSaving.value = true                                            // 锁定保存和删除动作
  feedback.value = ''                                              // 清理旧反馈
  errorMessage.value = ''                                         // 清理旧错误
  try {
    await AgentAPI.updateConfig({ mcpServers: serializedServers(draft.value.mcpServers), lspServers: serializedServers(draft.value.lspServers), skills: draft.value.skills || { enabled: true, directories: [], disabled: [] } }) // 只提交能力中心负责字段
    await capabilityStore.reload()                                 // 声明落盘后真实重建连接并刷新顶部状态窗
    const config = await AgentAPI.getConfig()                       // 读取 Server 规范化后的最终配置
    draft.value = editableConfig(config)                            // 草稿同步规范化配置和稳定键值行
    feedback.value = '配置已保存，运行能力已更新'                   // 明确反馈两个阶段均完成
  } catch (error) {
    errorMessage.value = error.message                             // 失败保留草稿供修改重试
  } finally {
    isSaving.value = false                                         // 恢复保存动作
  }
}


// --- 新增一个 MCP 服务 ---
function addMCP() {
  const name = uniqueName('mcp', draft.value.mcpServers || {})      // 创建不覆盖现有服务的名称
  draft.value.mcpServers[name] = { enabled: true, transport: 'stdio', command: '', args: [], cwd: '', env: {}, headers: {}, _envRows: [], _headersRows: [] } // 使用可直接编辑的 stdio 默认结构
  activeTab.value = 'mcp'                                          // 保持用户位于新增服务分类
}


// --- 新增一个 LSP 服务 ---
function addLSP() {
  const name = uniqueName('language-server', draft.value.lspServers || {}) // 创建稳定默认名称
  draft.value.lspServers[name] = { enabled: true, command: '', args: [], root: '', languageId: '', extensions: [], env: {}, _envRows: [] } // 初始化完整声明
  activeTab.value = 'lsp'                                          // 保持用户位于新增服务分类
}


// --- 创建未占用配置名称 ---
function uniqueName(prefix, collection) {
  let index = 1                                                     // 名称从易读的 1 开始
  while (`${prefix}-${index}` in collection) index += 1             // 跳过已有名称
  return `${prefix}-${index}`                                       // 返回可直接保存的键
}


// --- 重命名一个服务配置 ---
function renameServer(collectionName, oldName, nextName) {
  const name = nextName.trim()                                      // 去除表单首尾空白
  const collection = draft.value[collectionName]                    // 读取目标配置集合
  if (!name || name === oldName || collection[name]) return         // 空名称、未变化或冲突时保留原键
  collection[name] = collection[oldName]                            // 先复制完整声明到新名称
  delete collection[oldName]                                       // 再删除旧键完成原子式重命名
}


// --- 删除一个服务配置 ---
function removeServer(collectionName, name) {
  delete draft.value[collectionName][name]                          // 保存时完整集合替换会真实关闭并移除服务
}


// --- 在多行文本与参数数组间转换 ---
function setLines(target, field, value) {
  target[field] = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) // 每行一个参数可安全保留路径内空格
}


// --- 新增一个环境变量或请求头 ---
function addPair(target, field) {
  target[`_${field}Rows`].push({ key: '', value: '' })               // 行身份不依赖键名，编辑过程不会重建相邻输入
}


// --- 新增 Skill 根目录 ---
function addSkillDirectory() {
  draft.value.skills.directories.push('')                            // 新增空行等待用户输入真实目录
}


// --- 修改 Skill 启用状态 ---
function setSkillEnabled(name, enabled) {
  const disabled = new Set(draft.value.skills.disabled || [])       // 用集合避免重复禁用名称
  if (enabled) disabled.delete(name)                                // 启用时从禁用清单移除
  else disabled.add(name)                                           // 关闭时加入禁用清单
  draft.value.skills.disabled = [...disabled]                       // 写回可持久化数组
}


// --- 读取服务对应的运行状态 ---
function serverState(kind, name) {
  return capabilities.value[kind]?.find((item) => item.name === name) || { status: 'unsaved', error: '', toolCount: 0 } // 新草稿显示未保存
}


// --- 将来源名称转换为可读分组 ---
function sourceLabel(source) {
  return { 'built-in': '内置', custom: '自定义', mcp: 'MCP', lsp: 'LSP', skill: 'Skills', skills: 'Skills' }[source] || source // 未知来源保留原值
}


onMounted(loadCapabilities)                                          // 首次进入读取真实能力
</script>

<template>
  <section class="capability-view" :class="{ 'workspace-view': !embedded, 'capability-view--embedded': embedded }">
    <header class="view-header">
      <div>
        <h1>{{ embedded ? '扩展能力' : '能力' }}</h1>
        <p>{{ capabilities.tools.length }} 个工具 · {{ connectedMCP }} MCP · {{ connectedLSP }} LSP · {{ enabledSkills }} Skills</p>
      </div>
      <div class="capability-actions">
        <mdui-button variant="text" :loading="isLoading" @click="reloadCapabilities"><mdui-icon-refresh slot="icon"></mdui-icon-refresh>重载</mdui-button>
        <mdui-button variant="filled" :disabled="!draft || isSaving" :loading="isSaving" @click="saveCapabilities">保存并应用</mdui-button>
      </div>
    </header>

    <nav class="capability-tabs" role="tablist" aria-label="能力分类">
      <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id" :class="{ 'is-active': activeTab === tab.id }" @click="activeTab = tab.id">{{ tab.label }}</button>
    </nav>
    <div v-if="feedback" class="notice notice--success">{{ feedback }}</div>
    <div v-if="errorMessage" class="notice notice--error">{{ errorMessage }}</div>
    <div v-if="isLoading && !draft" class="view-loading">正在读取能力…</div>

    <template v-else-if="draft">
      <section v-if="activeTab === 'tools'" class="capability-content">
        <div v-for="(group, source) in toolGroups" :key="source" class="capability-group">
          <header><h2>{{ sourceLabel(source) }}</h2><span>{{ group.length }}</span></header>
          <div class="tool-list">
            <article v-for="tool in group" :key="tool.name" class="tool-row">
              <span class="tool-item__icon">›_</span>
              <div><strong>{{ tool.label || tool.name }}</strong><code>{{ tool.name }}</code><p>{{ tool.description }}</p></div>
              <small>{{ tool.server || tool.source }}</small>
            </article>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'mcp'" class="capability-content">
        <header class="capability-content__header"><div><h2>MCP 服务</h2><p>连接本地 stdio 或 Streamable HTTP 服务，将远程工具加入 Agent。</p></div><mdui-button variant="tonal" @click="addMCP"><mdui-icon-add slot="icon"></mdui-icon-add>添加服务</mdui-button></header>
        <div v-if="!Object.keys(draft.mcpServers || {}).length" class="capability-empty">尚未配置 MCP 服务</div>
        <mdui-collapse v-else accordion class="service-list">
          <mdui-collapse-item v-for="(server, name) in draft.mcpServers" :key="name">
            <div slot="header" class="service-row__header">
              <span class="service-status" :class="`is-${serverState('mcp', name).status}`"></span>
              <div><strong>{{ name }}</strong><small>{{ server.transport }} · {{ serverState('mcp', name).toolCount || 0 }} 个工具</small></div>
              <span>{{ serverState('mcp', name).status }}</span><mdui-icon-expand-more></mdui-icon-expand-more>
            </div>
            <div class="service-editor">
              <div v-if="serverState('mcp', name).error" class="notice notice--error">{{ serverState('mcp', name).error }}</div>
              <div class="service-editor__toolbar"><mdui-switch :checked="server.enabled !== false" @change="server.enabled = $event.target.checked"></mdui-switch><span>启用</span><mdui-button-icon aria-label="删除服务" @click="removeServer('mcpServers', name)"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon></div>
              <div class="service-fields">
                <mdui-text-field label="服务名称" variant="outlined" :value="name" @change="renameServer('mcpServers', name, $event.target.value)"></mdui-text-field>
                <label class="native-field"><span>传输</span><select v-model="server.transport"><option value="stdio">stdio</option><option value="http">Streamable HTTP</option></select></label>
                <mdui-text-field v-if="server.transport === 'http'" class="service-fields__wide" label="MCP URL" variant="outlined" :value="server.url || ''" @input="server.url = $event.target.value"></mdui-text-field>
                <template v-else>
                  <mdui-text-field label="命令" variant="outlined" :value="server.command || ''" @input="server.command = $event.target.value"></mdui-text-field>
                  <mdui-text-field label="工作目录" variant="outlined" :value="server.cwd || ''" @input="server.cwd = $event.target.value"></mdui-text-field>
                  <mdui-text-field class="service-fields__wide" label="参数（每行一个）" variant="outlined" autosize :min-rows="2" :value="(server.args || []).join('\n')" @input="setLines(server, 'args', $event.target.value)"></mdui-text-field>
                </template>
              </div>
              <section class="pair-editor">
                <header><strong>{{ server.transport === 'http' ? '请求头' : '环境变量' }}</strong><mdui-button-icon :aria-label="server.transport === 'http' ? '添加请求头' : '添加环境变量'" @click="addPair(server, server.transport === 'http' ? 'headers' : 'env')"><mdui-icon-add></mdui-icon-add></mdui-button-icon></header>
                <div v-for="(row, index) in server[server.transport === 'http' ? '_headersRows' : '_envRows']" :key="index" class="pair-row"><input v-model="row.key" aria-label="键名"><input v-model="row.value" aria-label="值" :type="/authorization|api[-_]?key|token|cookie|secret|password/i.test(row.key) ? 'password' : 'text'"><mdui-button-icon aria-label="删除键值" @click="server[server.transport === 'http' ? '_headersRows' : '_envRows'].splice(index, 1)"><mdui-icon-close></mdui-icon-close></mdui-button-icon></div>
              </section>
            </div>
          </mdui-collapse-item>
        </mdui-collapse>
      </section>

      <section v-else-if="activeTab === 'lsp'" class="capability-content">
        <header class="capability-content__header"><div><h2>语言服务器</h2><p>为 Agent 提供真实代码诊断、定义、引用与悬停信息。</p></div><mdui-button variant="tonal" @click="addLSP"><mdui-icon-add slot="icon"></mdui-icon-add>添加服务</mdui-button></header>
        <div v-if="!Object.keys(draft.lspServers || {}).length" class="capability-empty">尚未配置语言服务器</div>
        <mdui-collapse v-else accordion class="service-list">
          <mdui-collapse-item v-for="(server, name) in draft.lspServers" :key="name">
            <div slot="header" class="service-row__header">
              <span class="service-status" :class="`is-${serverState('lsp', name).status}`"></span>
              <div><strong>{{ name }}</strong><small>{{ (server.extensions || []).join(', ') || '未映射扩展名' }}</small></div>
              <span>{{ serverState('lsp', name).status }}</span><mdui-icon-expand-more></mdui-icon-expand-more>
            </div>
            <div class="service-editor">
              <div v-if="serverState('lsp', name).error" class="notice notice--error">{{ serverState('lsp', name).error }}</div>
              <div class="service-editor__toolbar"><mdui-switch :checked="server.enabled !== false" @change="server.enabled = $event.target.checked"></mdui-switch><span>启用</span><mdui-button-icon aria-label="删除服务" @click="removeServer('lspServers', name)"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon></div>
              <div class="service-fields">
                <mdui-text-field label="服务名称" variant="outlined" :value="name" @change="renameServer('lspServers', name, $event.target.value)"></mdui-text-field>
                <mdui-text-field label="命令" variant="outlined" :value="server.command || ''" @input="server.command = $event.target.value"></mdui-text-field>
                <mdui-text-field label="语言 ID" variant="outlined" :value="server.languageId || ''" @input="server.languageId = $event.target.value"></mdui-text-field>
                <mdui-text-field label="工作区根目录" variant="outlined" :value="server.root || ''" @input="server.root = $event.target.value"></mdui-text-field>
                <mdui-text-field class="service-fields__wide" label="文件扩展名（逗号分隔）" variant="outlined" :value="(server.extensions || []).join(', ')" @input="server.extensions = $event.target.value.split(',').map((item) => item.trim()).filter(Boolean)"></mdui-text-field>
                <mdui-text-field class="service-fields__wide" label="参数（每行一个）" variant="outlined" autosize :min-rows="2" :value="(server.args || []).join('\n')" @input="setLines(server, 'args', $event.target.value)"></mdui-text-field>
              </div>
              <section class="pair-editor">
                <header><strong>环境变量</strong><mdui-button-icon aria-label="添加环境变量" @click="addPair(server, 'env')"><mdui-icon-add></mdui-icon-add></mdui-button-icon></header>
                <div v-for="(row, index) in server._envRows" :key="index" class="pair-row"><input v-model="row.key" aria-label="键名"><input v-model="row.value" aria-label="值" :type="/api[-_]?key|token|secret|password/i.test(row.key) ? 'password' : 'text'"><mdui-button-icon aria-label="删除键值" @click="server._envRows.splice(index, 1)"><mdui-icon-close></mdui-icon-close></mdui-button-icon></div>
              </section>
            </div>
          </mdui-collapse-item>
        </mdui-collapse>
      </section>

      <section v-else class="capability-content">
        <header class="capability-content__header"><div><h2>Agent Skills</h2><p>启动只读取元数据，任务匹配时由 Agent 按需加载完整 SKILL.md。</p></div><mdui-switch :checked="draft.skills.enabled !== false" @change="draft.skills.enabled = $event.target.checked"></mdui-switch></header>
        <div class="skill-directories">
          <header><strong>附加目录</strong><mdui-button-icon aria-label="添加目录" @click="addSkillDirectory"><mdui-icon-add></mdui-icon-add></mdui-button-icon></header>
          <div v-for="(_, index) in draft.skills.directories" :key="index" class="directory-row"><mdui-text-field label="Skill 根目录" variant="outlined" :value="draft.skills.directories[index]" @input="draft.skills.directories[index] = $event.target.value"></mdui-text-field><mdui-button-icon aria-label="移除目录" @click="draft.skills.directories.splice(index, 1)"><mdui-icon-close></mdui-icon-close></mdui-button-icon></div>
        </div>
        <div v-if="capabilities.skillErrors.length" class="skill-errors"><div v-for="item in capabilities.skillErrors" :key="item.directory" class="notice notice--error"><code>{{ item.directory }}</code> · {{ item.error }}</div></div>
        <div v-if="!capabilities.skills.length" class="capability-empty">未发现 Skill。默认扫描用户目录和项目的 .agent/skills。</div>
        <div v-else class="skill-list">
          <article v-for="skill in capabilities.skills" :key="skill.name" class="skill-row">
            <mdui-checkbox :checked="!draft.skills.disabled.includes(skill.name)" @change="setSkillEnabled(skill.name, $event.target.checked)"></mdui-checkbox>
            <div><strong>{{ skill.name }}</strong><p>{{ skill.description }}</p><code>{{ skill.directory }}</code></div>
            <small>{{ skill.metadata?.version || skill.license || 'SKILL.md' }}</small>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>
