<!--
能力中心：管理 Agent 内置工具、MCP 服务、LSP 服务和渐进披露 Skills。
用户保存声明后触发 Server 重建连接，页面再以真实运行状态替换草稿反馈。
调用示例：Settings 在能力分类中渲染 <CapabilitySettings embedded />。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'                   // 引入能力清单、当前分类和首次加载能力
import { storeToRefs } from 'pinia'                              // 保持共享能力快照响应性
import { Capability } from '../commands/capability.js'           // 引入能力草稿和生命周期指令
import { useCapabilityStore } from '../stores/capabilities.js'  // 引入顶部与设置页共享运行态
import { watchCapabilitySection } from '../watchers.js'          // 引入集中管理的分类同步监听

const props = defineProps({ embedded: { type: Boolean, default: false }, section: { type: String, default: '' } }) // 设置页可固定到独立 MCP、LSP 或技能分类
const capabilityStore = useCapabilityStore()                    // 只读取唯一能力数据
const { snapshot: capabilities, draft, isLoading, isSaving, feedback, errorMessage } = storeToRefs(capabilityStore) // 读取运行态、草稿和反馈数据
const activeTab = ref(props.section || (props.embedded ? 'mcp' : 'tools')) // 独立设置分类直接展示目标内容
const baseTabs = [                                               // 稳定标签顺序支持键盘和测试定位
  { id: 'tools', label: '工具' },
  { id: 'mcp', label: 'MCP' },
  { id: 'lsp', label: 'LSP' },
  { id: 'skills', label: 'Skills' },
]
const tabs = computed(() => props.section ? [] : (props.embedded ? [baseTabs[1], baseTabs[2], baseTabs[3], baseTabs[0]] : baseTabs)) // 独立设置页不重复显示总能力标签
const sectionTitle = computed(() => ({ mcp: 'MCP', lsp: 'LSP', skills: '技能' }[activeTab.value] || '工具')) // 设置标题对应当前独立分类
const sectionSummary = computed(() => ({ mcp: `${connectedMCP.value} / ${capabilities.value.mcp.length} 已连接`, lsp: `${connectedLSP.value} / ${capabilities.value.lsp.length} 已连接`, skills: `${enabledSkills.value} / ${capabilities.value.skills.length} 已启用` }[activeTab.value] || `${capabilities.value.tools.length} 个可用工具`)) // 标题只反馈当前页面状态

const toolGroups = computed(() => (capabilities.value.tools || []).reduce((groups, tool) => { const source = tool.kind || tool.source || 'built-in'; (groups[source] ||= []).push(tool); return groups }, {})) // 按来源组织密集工具清单并兼容旧桌面浏览器
const connectedMCP = computed(() => capabilities.value.mcp.filter((item) => item.status === 'connected').length) // 标题展示真实 MCP 可用数
const connectedLSP = computed(() => capabilities.value.lsp.filter((item) => item.status === 'connected').length) // 标题展示真实 LSP 可用数
const enabledSkills = computed(() => capabilities.value.skills.filter((item) => item.enabled).length) // 标题展示注入模型的 Skill 数

// --- 切换能力分类 ---
function selectSection(section) {
  Capability.selectSection(activeTab, section)                      // 将分类触发交给能力指令修改数据
}


watchCapabilitySection(() => props.section, selectSection)          // 集中监听设置一级导航变化


// --- 读取真实能力与配置 ---
async function loadCapabilities() {
  try { await Capability.loadSettings() } catch {}                 // 指令负责写入运行态、草稿和错误反馈
}


// --- 重载当前能力运行态 ---
async function reloadCapabilities() {
  try { await Capability.reload() } catch {}                       // 指令负责重建能力和反馈结果
}


// --- 保存外部能力声明并重连 ---
async function saveCapabilities() {
  await Capability.save()                                         // 指令保存声明、重建连接并更新全部数据
}


// --- 新增一个 MCP 服务 ---
function addMCP() {
  Capability.addMCP(activeTab)                                     // 指令新增 MCP 并保持对应分类
}


// --- 新增一个 LSP 服务 ---
function addLSP() {
  Capability.addLSP(activeTab)                                     // 指令新增 LSP 并保持对应分类
}


// --- 读取服务对应的运行状态 ---
function serverState(kind, name) {
  return Capability.getServerState(kind, name)                      // 指令读取真实状态或未保存反馈
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
        <h1>{{ props.section ? sectionTitle : (embedded ? '扩展能力' : '能力') }}</h1>
        <p>{{ props.section ? sectionSummary : `${capabilities.tools.length} 个工具 · ${connectedMCP} MCP · ${connectedLSP} LSP · ${enabledSkills} Skills` }}</p>
      </div>
      <div class="capability-actions">
        <mdui-button variant="text" :loading="isLoading" @click="reloadCapabilities"><mdui-icon-refresh slot="icon"></mdui-icon-refresh>重载</mdui-button>
        <mdui-button variant="filled" :disabled="!draft || isSaving" :loading="isSaving" @click="saveCapabilities">保存并应用</mdui-button>
      </div>
    </header>

    <nav v-if="tabs.length" class="capability-tabs" role="tablist" aria-label="能力分类">
      <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id" :class="{ 'is-active': activeTab === tab.id }" @click="selectSection(tab.id)">{{ tab.label }}</button>
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
              <div class="service-editor__toolbar"><mdui-switch :checked="server.enabled !== false" @change="Capability.setValue(server, 'enabled', $event.target.checked)"></mdui-switch><span>启用</span><mdui-button-icon aria-label="删除服务" @click="Capability.removeServer('mcpServers', name)"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon></div>
              <div class="service-fields">
                <mdui-text-field label="服务名称" variant="outlined" :value="name" @change="Capability.renameServer('mcpServers', name, $event.target.value)"></mdui-text-field>
                <label class="native-field"><span>传输</span><select :value="server.transport" @change="Capability.setValue(server, 'transport', $event.target.value)"><option value="stdio">stdio</option><option value="http">Streamable HTTP</option></select></label>
                <mdui-text-field v-if="server.transport === 'http'" class="service-fields__wide" label="MCP URL" variant="outlined" :value="server.url || ''" @input="Capability.setValue(server, 'url', $event.target.value)"></mdui-text-field>
                <template v-else>
                  <mdui-text-field label="命令" variant="outlined" :value="server.command || ''" @input="Capability.setValue(server, 'command', $event.target.value)"></mdui-text-field>
                  <mdui-text-field label="工作目录" variant="outlined" :value="server.cwd || ''" @input="Capability.setValue(server, 'cwd', $event.target.value)"></mdui-text-field>
                  <mdui-text-field class="service-fields__wide" label="参数（每行一个）" variant="outlined" autosize :min-rows="2" :value="(server.args || []).join('\n')" @input="Capability.setLines(server, 'args', $event.target.value)"></mdui-text-field>
                </template>
              </div>
              <section class="pair-editor">
                <header><strong>{{ server.transport === 'http' ? '请求头' : '环境变量' }}</strong><mdui-button-icon :aria-label="server.transport === 'http' ? '添加请求头' : '添加环境变量'" @click="Capability.addPair(server, server.transport === 'http' ? 'headers' : 'env')"><mdui-icon-add></mdui-icon-add></mdui-button-icon></header>
                <div v-for="(row, index) in server[server.transport === 'http' ? '_headersRows' : '_envRows']" :key="index" class="pair-row"><input :value="row.key" aria-label="键名" @input="Capability.setPairValue(row, 'key', $event.target.value)"><input :value="row.value" aria-label="值" :type="/authorization|api[-_]?key|token|cookie|secret|password/i.test(row.key) ? 'password' : 'text'" @input="Capability.setPairValue(row, 'value', $event.target.value)"><mdui-button-icon aria-label="删除键值" @click="Capability.removePair(server, server.transport === 'http' ? 'headers' : 'env', index)"><mdui-icon-close></mdui-icon-close></mdui-button-icon></div>
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
              <div class="service-editor__toolbar"><mdui-switch :checked="server.enabled !== false" @change="Capability.setValue(server, 'enabled', $event.target.checked)"></mdui-switch><span>启用</span><mdui-button-icon aria-label="删除服务" @click="Capability.removeServer('lspServers', name)"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon></div>
              <div class="service-fields">
                <mdui-text-field label="服务名称" variant="outlined" :value="name" @change="Capability.renameServer('lspServers', name, $event.target.value)"></mdui-text-field>
                <mdui-text-field label="命令" variant="outlined" :value="server.command || ''" @input="Capability.setValue(server, 'command', $event.target.value)"></mdui-text-field>
                <mdui-text-field label="语言 ID" variant="outlined" :value="server.languageId || ''" @input="Capability.setValue(server, 'languageId', $event.target.value)"></mdui-text-field>
                <mdui-text-field label="工作区根目录" variant="outlined" :value="server.root || ''" @input="Capability.setValue(server, 'root', $event.target.value)"></mdui-text-field>
                <mdui-text-field class="service-fields__wide" label="文件扩展名（逗号分隔）" variant="outlined" :value="(server.extensions || []).join(', ')" @input="Capability.setCommaList(server, 'extensions', $event.target.value)"></mdui-text-field>
                <mdui-text-field class="service-fields__wide" label="参数（每行一个）" variant="outlined" autosize :min-rows="2" :value="(server.args || []).join('\n')" @input="Capability.setLines(server, 'args', $event.target.value)"></mdui-text-field>
              </div>
              <section class="pair-editor">
                <header><strong>环境变量</strong><mdui-button-icon aria-label="添加环境变量" @click="Capability.addPair(server, 'env')"><mdui-icon-add></mdui-icon-add></mdui-button-icon></header>
                <div v-for="(row, index) in server._envRows" :key="index" class="pair-row"><input :value="row.key" aria-label="键名" @input="Capability.setPairValue(row, 'key', $event.target.value)"><input :value="row.value" aria-label="值" :type="/api[-_]?key|token|secret|password/i.test(row.key) ? 'password' : 'text'" @input="Capability.setPairValue(row, 'value', $event.target.value)"><mdui-button-icon aria-label="删除键值" @click="Capability.removePair(server, 'env', index)"><mdui-icon-close></mdui-icon-close></mdui-button-icon></div>
              </section>
            </div>
          </mdui-collapse-item>
        </mdui-collapse>
      </section>

      <section v-else class="capability-content">
        <header class="capability-content__header"><div><h2>Agent Skills</h2><p>启动只读取元数据，任务匹配时由 Agent 按需加载完整 SKILL.md。</p></div><mdui-switch :checked="draft.skills.enabled !== false" @change="Capability.setSkillsEnabled($event.target.checked)"></mdui-switch></header>
        <div class="skill-directories">
          <header><strong>附加目录</strong><mdui-button-icon aria-label="添加目录" @click="Capability.addSkillDirectory"><mdui-icon-add></mdui-icon-add></mdui-button-icon></header>
          <div v-for="(_, index) in draft.skills.directories" :key="index" class="directory-row"><mdui-text-field label="Skill 根目录" variant="outlined" :value="draft.skills.directories[index]" @input="Capability.setSkillDirectory(index, $event.target.value)"></mdui-text-field><mdui-button-icon aria-label="移除目录" @click="Capability.removeSkillDirectory(index)"><mdui-icon-close></mdui-icon-close></mdui-button-icon></div>
        </div>
        <div v-if="capabilities.skillErrors.length" class="skill-errors"><div v-for="item in capabilities.skillErrors" :key="item.directory" class="notice notice--error"><code>{{ item.directory }}</code> · {{ item.error }}</div></div>
        <div v-if="!capabilities.skills.length" class="capability-empty">未发现 Skill。默认扫描用户目录和项目的 .agent/skills。</div>
        <div v-else class="skill-list">
          <article v-for="skill in capabilities.skills" :key="skill.name" class="skill-row">
            <mdui-checkbox :checked="!draft.skills.disabled.includes(skill.name)" @change="Capability.setSkillEnabled(skill.name, $event.target.checked)"></mdui-checkbox>
            <div><strong>{{ skill.name }}</strong><p>{{ skill.description }}</p><code>{{ skill.directory }}</code></div>
            <small>{{ skill.metadata?.version || skill.license || 'SKILL.md' }}</small>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>
