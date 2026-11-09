<!--
输入区的工具权限小窗：一行一个工具，右侧选择直接执行、AI 审核、每次询问或拒绝。
最上面一行是默认动作，处理没有单独设置的工具。

为什么放在输入区：要不要自动执行、要不要让 AI 先审，是发这条消息时就在想的事。
放设置页意味着干活时得离开对话去翻设置，回来上下文已经断了。

只写 permission，不动 providers / mcp / prompt 这些字段：
PATCH /config/set 是整份替换，所以请求体里其余字段原样带上 store.config.raw。

调用示例：
<ComposerTools />
-->
<script setup>
import { computed, nextTick, ref, useId } from 'vue'
import Icon from '../../ui/Icon.vue'
import Select from '../../ui/Select.vue'
import { usePopup } from '../../utils/popup.js'
import { store } from '../../store.js'
import { AgentAPI } from '../../utils/api.js'
import { Notice } from '../../utils/notice.js'

const id = useId()
const { trigger, popup, open, position, toggle, hide, onToggle } = usePopup({ align: 'start' })
const busy = ref('')

// 只列可配置的工具：attempt_completion 这类内部工具由 kind: 'never' 标出来，
// 它们不碰磁盘也没有「要不要批准」这回事，摆出来只会让人以为能关掉。
const tools = computed(() => (store.config.tools || []).filter(tool => tool.configurable !== false))
const rules = computed(() => store.config.raw?.permission || {})

const ACTIONS = ['allow', 'review', 'ask', 'deny']
const normalizeAction = value => ACTIONS.includes(value) ? value : 'ask'

const toolActions = [
  { value: 'ask', label: '每次询问' },
  { value: 'review', label: 'AI 审核' },
  { value: 'allow', label: '直接执行' },
  { value: 'deny', label: '拒绝' },
]
const defaultActions = [
  { value: 'ask', label: '每次询问' },
  { value: 'review', label: '全部 AI 审核' },
  { value: 'allow', label: '全部批准' },
  { value: 'deny', label: '全部拒绝' },
]

// --- 一个工具自己的默认动作：先看工具规则，再看全局规则 ---
function rawActionOf(name, permission = rules.value) {
  const rule = permission[name]
  if (typeof rule === 'string') return normalizeAction(rule)
  if (rule && typeof rule === 'object' && !Array.isArray(rule)) return normalizeAction(rule['*'])
  return normalizeAction(permission['*'])
}

const defaultAction = computed(() => normalizeAction(rules.value['*']))

// 审批层里全局 allow 会盖过工具自己的 ask / review（「全部批准」的承诺），
// 所以全局开着时每个工具实际都是直接执行，这里必须照实显示，否则下拉框在说谎。
const actionOf = tool => {
  const own = rawActionOf(tool.name)
  if (own === 'deny') return 'deny'
  return defaultAction.value === 'allow' && (own === 'ask' || own === 'review') ? 'allow' : own
}
const allowedCount = computed(() => tools.value.filter(tool => actionOf(tool) === 'allow').length)

// --- 只算权限这一份，其余配置原样带回去 ---
// 对象形式的规则（命令工具按参数记的那套）要保住：只改里面的 '*'，
// 不能整个替换成字符串，否则用户记住的参数级规则会一起丢掉。
function permissionWith(name, value, from = rules.value) {
  const permission = { ...from }
  const current = permission[name]
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    permission[name] = { ...current, '*': value }
  } else {
    permission[name] = value
  }
  return permission
}

async function save(permission) {
  const raw = store.config.raw || {}
  await AgentAPI.updateConfig({
    providers: raw.providers || [],
    mcp: raw.mcp || {},
    permission,
    prompt: raw.prompt || { system: '', seeded: true },
    models: raw.models || {},
    compact: raw.compact || { threshold: 0.8 },
    // 审核配置不归这里改，但整份替换必须原样带上，否则会被服务端默认值抹掉。
    review: raw.review || {},
  })
  // 就地更新，不重新拉全量配置：小窗关掉再打开时状态要立刻是对的。
  store.config.raw = { ...raw, permission }
  store.config.tools = (store.config.tools || []).map(item => ({
    ...item,
    permission: rawActionOf(item.name, permission),
  }))
}

async function change(name, permission) {
  if (busy.value) return
  busy.value = name
  try {
    await save(permission)
  } catch (error) {
    Notice.show(error.message)
  } finally {
    busy.value = ''
  }
}

function setDefault(value) {
  return change('*', { ...rules.value, '*': value })
}

async function setTool(tool, value) {
  let permission = permissionWith(tool.name, value)
  // 全局 allow 会盖掉单个工具的 ask / review，不撤全局就等于这一下没改。
  // 撤之前先把其余工具此刻的「已自动执行」逐个写实，否则它们会跟着全局
  // 一起掉回先询问，看起来像被这一下连带关掉了。
  if (defaultAction.value === 'allow' && (value === 'ask' || value === 'review')) {
    for (const item of tools.value) {
      if (item.name === tool.name || rawActionOf(item.name) === 'deny') continue
      permission = permissionWith(item.name, 'allow', permission)
    }
    permission['*'] = 'ask'
  }
  return change(tool.name, permission)
}

// 打开时把焦点交给默认动作，键盘能直接操作。
function handleToggle(event) {
  onToggle(event)
  if (event.newState === 'open') nextTick(() => popup.value?.querySelector('button')?.focus())
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    hide(true)
    return
  }
  if (event.key !== 'Tab') return
  // 下拉框自己处理 Tab（关掉列表后交还给浏览器）；这里不能抢它的焦点。
  if (event.target.closest?.('.ui-select')) return
  const focusable = [...popup.value.querySelectorAll('button:not(:disabled)')]
    .filter(element => !element.closest('.ui-select'))
  const index = focusable.indexOf(document.activeElement)
  const next = index + (event.shiftKey ? -1 : 1)
  event.preventDefault()
  if (next < 0 || next >= focusable.length) hide(true)
  else focusable[next].focus()
}
</script>

<template>
  <span class="composer-tools">
    <button
      ref="trigger" type="button" class="composer-tools__trigger"
      :aria-label="`工具权限（${allowedCount}/${tools.length} 自动执行）`"
      aria-haspopup="dialog" :aria-expanded="open" :aria-controls="id"
      @click="toggle"
    >
      <Icon name="permission" :size="18" />
      <span class="composer-tools__count">{{ allowedCount }}/{{ tools.length }}</span>
    </button>

    <div
      :id="id" ref="popup" popover="auto" role="dialog" aria-label="工具权限"
      class="composer-tools__popup" :style="position"
      @toggle="handleToggle" @keydown="onKeydown"
    >
      <header class="composer-tools__head">
        <p class="composer-tools__title">工具权限</p>
      </header>

      <div v-if="tools.length" class="composer-tools__list">
        <div class="composer-tools__row composer-tools__row--default">
          <span class="composer-tools__name">默认动作</span>
          <Select
            class="composer-tools__select" label="默认动作"
            :model-value="defaultAction" :items="defaultActions" :disabled="busy === '*'"
            @update:model-value="setDefault"
          />
        </div>
        <div v-for="tool in tools" :key="tool.name" class="composer-tools__row">
          <span class="composer-tools__name" :title="`${tool.kindLabel || tool.kind} · ${tool.name}`">{{ tool.title || tool.name }}</span>
          <Select
            class="composer-tools__select" :label="`${tool.title || tool.name} 权限`"
            :model-value="actionOf(tool)" :items="toolActions" :disabled="busy === tool.name"
            @update:model-value="value => setTool(tool, value)"
          />
        </div>
      </div>
      <p v-else class="composer-tools__empty">暂无可配置的工具</p>

      <p class="composer-tools__hint">没有单独设置的工具按默认动作处理。拒绝是硬规则；AI 审核需要先在「设置 → 自动审核」里启用。</p>
    </div>
  </span>
</template>

<style scoped lang="scss" src="../../styles/components/composer/ComposerTools.scss"></style>
