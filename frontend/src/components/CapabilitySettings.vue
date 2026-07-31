<!--
能力中心：管理 Agent 内置工具、MCP 服务、LSP 服务和渐进披露 Skills。
用户保存声明后触发 Server 重建连接，页面再以真实运行状态替换草稿反馈。
调用示例：Settings 在能力分类中渲染 <CapabilitySettings embedded />。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'                   // 引入能力清单、当前分类和首次加载能力
import { Capability } from '../commands/capability.js'           // 引入能力草稿和生命周期指令
import { store } from '../store.js'                              // 引入唯一全局工作台数据
import { watchCapabilitySection } from '../watchers.js'          // 引入集中管理的分类同步监听

const props = defineProps({ embedded: { type: Boolean, default: false }, section: { type: String, default: '' } }) // 设置页可固定到独立 MCP、LSP 或技能分类
const capabilityStore = store.capabilities                        // 只读取唯一能力数据
const capabilities = computed(() => capabilityStore.snapshot)       // 读取会被指令替换的运行态数据
const draft = computed(() => capabilityStore.draft)                 // 读取会被指令替换的可编辑草稿
const isLoading = computed(() => capabilityStore.isLoading)          // 读取加载反馈
const isSaving = computed(() => capabilityStore.isSaving)            // 读取保存反馈
const feedback = computed(() => capabilityStore.feedback)            // 读取成功反馈
const errorMessage = computed(() => capabilityStore.errorMessage)    // 读取错误反馈
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

watchCapabilitySection(() => props.section, (section) => {          // 一级设置变化后同步当前能力分类
  activeTab.value = section
})


// --- 将来源名称转换为可读分组 ---
function sourceLabel(source) {
  return { 'built-in': '内置', custom: '自定义', mcp: 'MCP', lsp: 'LSP', skill: 'Skills', skills: 'Skills' }[source] || source // 未知来源保留原值
}


onMounted(() => Capability.loadSettings().catch(() => {}))          // 首次进入读取真实能力
</script>

<template>
  <section class="capability-view" :class="{ 'workspace-view': !embedded, 'capability-view--embedded': embedded }">
    <header class="view-header">
      <div>
        <h1>{{ props.section ? sectionTitle : (embedded ? '扩展能力' : '能力') }}</h1>
        <p>{{ props.section ? sectionSummary : `${capabilities.tools.length} 个工具 · ${connectedMCP} MCP · ${connectedLSP} LSP · ${enabledSkills} Skills` }}</p>
      </div>
      <div class="capability-actions">
        <mdui-button variant="text" :loading="isLoading" @click="Capability.reload().catch(() => {})"><mdui-icon-refresh slot="icon"></mdui-icon-refresh>重载</mdui-button>
        <mdui-button variant="filled" :disabled="!draft || isSaving" :loading="isSaving" @click="Capability.save">保存并应用</mdui-button>
      </div>
    </header>

    <nav v-if="tabs.length" class="capability-tabs" role="tablist" aria-label="能力分类">
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
        <header class="capability-content__header"><div><h2>MCP 服务</h2><p>连接本地 stdio 或 Streamable HTTP 服务，将远程工具加入 Agent。</p></div><mdui-button variant="tonal" @click="Capability.addMCP"><mdui-icon-add slot="icon"></mdui-icon-add>添加服务</mdui-button></header>
        <div v-if="!Object.keys(draft.mcpServers || {}).length" class="capability-empty">尚未配置 MCP 服务</div>
        <mdui-collapse v-else accordion class="service-list">
          <mdui-collapse-item v-for="(server, name) in draft.mcpServers" :key="name">
            <div slot="header" class="service-row__header">
              <span class="service-status" :class="`is-${Capability.getServerState('mcp', name).status}`"></span>
              <div><strong>{{ name }}</strong><small>{{ server.transport }} · {{ Capability.getServerState('mcp', name).toolCount || 0 }} 个工具</small></div>
              <span>{{ Capability.getServerState('mcp', name).status }}</span><mdui-icon-expand-more></mdui-icon-expand-more>
            </div>
            <div class="service-editor">
              <div v-if="Capability.getServerState('mcp', name).error" class="notice notice--error">{{ Capability.getServerState('mcp', name).error }}</div>
              <div class="service-editor__toolbar"><mdui-switch :checked="server.enabled !== false" @change="server.enabled = $event.target.checked"></mdui-switch><span>启用</span><mdui-button-icon aria-label="删除服务" @click="delete draft.mcpServers[name]"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon></div>
              <div class="service-fields">
                <mdui-text-field label="服务名称" variant="outlined" :value="name" @change="Capability.renameServer('mcpServers', name, $event.target.value)"></mdui-text-field>
                <label class="native-field"><span>传输</span><select :value="server.transport" @change="server.transport = $event.target.value"><option value="stdio">stdio</option><option value="http">Streamable HTTP</option></select></label>
                <mdui-text-field v-if="server.transport === 'http'" class="service-fields__wide" label="MCP URL" variant="outlined" :value="server.url || ''" @input="server.url = $event.target.value"></mdui-text-field>
                <template v-else>
                  <mdui-text-field label="命令" variant="outlined" :value="server.command || ''" @input="server.command = $event.target.value"></mdui-text-field>
                  <mdui-text-field label="工作目录" variant="outlined" :value="server.cwd || ''" @input="server.cwd = $event.target.value"></mdui-text-field>
                  <mdui-text-field class="service-fields__wide" label="参数（每行一个）" variant="outlined" autosize :min-rows="2" :value="(server.args || []).join('\n')" @input="Capability.setLines(server, 'args', $event.target.value)"></mdui-text-field>
                </template>
              </div>
              <section class="pair-editor">
                <header><strong>{{ server.transport === 'http' ? '请求头' : '环境变量' }}</strong><mdui-button-icon :aria-label="server.transport === 'http' ? '添加请求头' : '添加环境变量'" @click="server[server.transport === 'http' ? '_headersRows' : '_envRows'].push({ key: '', value: '' })"><mdui-icon-add></mdui-icon-add></mdui-button-icon></header>
                <div v-for="(row, index) in server[server.transport === 'http' ? '_headersRows' : '_envRows']" :key="index" class="pair-row"><input :value="row.key" aria-label="键名" @input="row.key = $event.target.value"><input :value="row.value" aria-label="值" :type="/authorization|api[-_]?key|token|cookie|secret|password/i.test(row.key) ? 'password' : 'text'" @input="row.value = $event.target.value"><mdui-button-icon aria-label="删除键值" @click="server[server.transport === 'http' ? '_headersRows' : '_envRows'].splice(index, 1)"><mdui-icon-close></mdui-icon-close></mdui-button-icon></div>
              </section>
            </div>
          </mdui-collapse-item>
        </mdui-collapse>
      </section>

      <section v-else-if="activeTab === 'lsp'" class="capability-content">
        <header class="capability-content__header"><div><h2>语言服务器</h2><p>为 Agent 提供真实代码诊断、定义、引用与悬停信息。</p></div><mdui-button variant="tonal" @click="Capability.addLSP"><mdui-icon-add slot="icon"></mdui-icon-add>添加服务</mdui-button></header>
        <div v-if="!Object.keys(draft.lspServers || {}).length" class="capability-empty">尚未配置语言服务器</div>
        <mdui-collapse v-else accordion class="service-list">
          <mdui-collapse-item v-for="(server, name) in draft.lspServers" :key="name">
            <div slot="header" class="service-row__header">
              <span class="service-status" :class="`is-${Capability.getServerState('lsp', name).status}`"></span>
              <div><strong>{{ name }}</strong><small>{{ (server.extensions || []).join(', ') || '未映射扩展名' }}</small></div>
              <span>{{ Capability.getServerState('lsp', name).status }}</span><mdui-icon-expand-more></mdui-icon-expand-more>
            </div>
            <div class="service-editor">
              <div v-if="Capability.getServerState('lsp', name).error" class="notice notice--error">{{ Capability.getServerState('lsp', name).error }}</div>
              <div class="service-editor__toolbar"><mdui-switch :checked="server.enabled !== false" @change="server.enabled = $event.target.checked"></mdui-switch><span>启用</span><mdui-button-icon aria-label="删除服务" @click="delete draft.lspServers[name]"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon></div>
              <div class="service-fields">
                <mdui-text-field label="服务名称" variant="outlined" :value="name" @change="Capability.renameServer('lspServers', name, $event.target.value)"></mdui-text-field>
                <mdui-text-field label="命令" variant="outlined" :value="server.command || ''" @input="server.command = $event.target.value"></mdui-text-field>
                <mdui-text-field label="语言 ID" variant="outlined" :value="server.languageId || ''" @input="server.languageId = $event.target.value"></mdui-text-field>
                <mdui-text-field label="工作区根目录" variant="outlined" :value="server.root || ''" @input="server.root = $event.target.value"></mdui-text-field>
                <mdui-text-field class="service-fields__wide" label="文件扩展名（逗号分隔）" variant="outlined" :value="(server.extensions || []).join(', ')" @input="Capability.setCommaList(server, 'extensions', $event.target.value)"></mdui-text-field>
                <mdui-text-field class="service-fields__wide" label="参数（每行一个）" variant="outlined" autosize :min-rows="2" :value="(server.args || []).join('\n')" @input="Capability.setLines(server, 'args', $event.target.value)"></mdui-text-field>
              </div>
              <section class="pair-editor">
                <header><strong>环境变量</strong><mdui-button-icon aria-label="添加环境变量" @click="server._envRows.push({ key: '', value: '' })"><mdui-icon-add></mdui-icon-add></mdui-button-icon></header>
                <div v-for="(row, index) in server._envRows" :key="index" class="pair-row"><input :value="row.key" aria-label="键名" @input="row.key = $event.target.value"><input :value="row.value" aria-label="值" :type="/api[-_]?key|token|secret|password/i.test(row.key) ? 'password' : 'text'" @input="row.value = $event.target.value"><mdui-button-icon aria-label="删除键值" @click="server._envRows.splice(index, 1)"><mdui-icon-close></mdui-icon-close></mdui-button-icon></div>
              </section>
            </div>
          </mdui-collapse-item>
        </mdui-collapse>
      </section>

      <section v-else class="capability-content">
        <header class="capability-content__header"><div><h2>Agent Skills</h2><p>启动只读取元数据，任务匹配时由 Agent 按需加载完整 SKILL.md。</p></div><mdui-switch :checked="draft.skills.enabled !== false" @change="draft.skills.enabled = $event.target.checked"></mdui-switch></header>
        <div class="skill-directories">
          <header><strong>附加目录</strong><mdui-button-icon aria-label="添加目录" @click="draft.skills.directories.push('')"><mdui-icon-add></mdui-icon-add></mdui-button-icon></header>
          <div v-for="(_, index) in draft.skills.directories" :key="index" class="directory-row"><mdui-text-field label="Skill 根目录" variant="outlined" :value="draft.skills.directories[index]" @input="draft.skills.directories[index] = $event.target.value"></mdui-text-field><mdui-button-icon aria-label="移除目录" @click="draft.skills.directories.splice(index, 1)"><mdui-icon-close></mdui-icon-close></mdui-button-icon></div>
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
