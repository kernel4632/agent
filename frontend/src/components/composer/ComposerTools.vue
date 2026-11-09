<!--
输入区的工具自动批准小窗：每个工具自己就是一个可点的开关，点一下在「自动执行」和「先问我」之间切换。
最上面一格是万能开关：点一下把下面所有工具一起打开，再点一下一起关掉。

为什么放在输入区：要不要自动执行，是发这条消息时就在想的事。放设置页意味着
干活时得离开对话去翻设置，回来上下文已经断了。

只写 permission，不动 providers / mcp / prompt 这些字段：
PATCH /config/set 是整份替换，所以请求体里其余字段原样带上 store.config.raw。

调用示例：
<ComposerTools />
-->
<script setup>
import { computed, nextTick, ref, useId } from 'vue'
import Icon from '../../ui/Icon.vue'
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
const allowAll = computed(() => (store.config.raw?.permission || {})['*'] === 'allow')

// 审批层里全局 allow 会盖过工具自己的 ask（「全部自动执行」的承诺），
// 所以全局开着时每个工具实际都是自动执行，这里必须照实显示，否则勾选状态在说谎。
// deny 是硬规则，全局放行也拦得住，不能画成开着。
const allowed = tool => tool.permission === 'deny' ? false : (allowAll.value || tool.permission === 'allow')
const allowedCount = computed(() => tools.value.filter(allowed).length)

// 万能开关的三态：全开是勾，关掉一部分是横线，全关是空。
// 全局 * 为 allow 也算全开：它已经让所有工具直接执行了。这时这一格不能变成「关着」，
// 否则点下去只会把全局再设一遍 allow，永远关不掉——用户要的是「集体开关」。
const masterOn = computed(() => allowAll.value || (tools.value.length > 0 && allowedCount.value === tools.value.length))
const partial = computed(() => !masterOn.value && allowedCount.value > 0)

// --- 只算权限这一份，其余配置原样带回去 ---
// 对象形式的规则（命令工具按参数记的那套）要保住：只改里面的 '*'，
// 不能整个替换成字符串，否则用户记住的参数级规则会一起丢掉。
function permissionWith(name, value, from = store.config.raw?.permission || {}) {
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
  })
  // 就地更新，不重新拉全量配置：小窗关掉再打开时状态要立刻是对的。
  store.config.raw = { ...raw, permission }
  store.config.tools = (store.config.tools || []).map(item => {
    const next = permission[item.name]
    const value = typeof next === 'string' ? next : next?.['*']
    return { ...item, permission: value === 'allow' ? 'allow' : value === 'deny' ? 'deny' : 'ask' }
  })
}

async function flip(tool) {
  if (busy.value) return
  const next = allowed(tool) ? 'ask' : 'allow'
  busy.value = tool.name
  try {
    let permission = permissionWith(tool.name, next)
    // 关掉单个工具时必须一并撤掉全局批准：审批层里全局 allow 会把工具的 ask 盖回去，
    // 不撤就等于这个开关按下去毫无效果。撤掉全局之前先把其余工具此刻的「已自动执行」
    // 逐个写实，否则它们会跟着全局一起掉回先询问，看起来像被这一下连带关掉了。
    if (next === 'ask' && allowAll.value) {
      for (const item of tools.value) {
        if (item.name === tool.name || item.permission === 'deny') continue
        permission = permissionWith(item.name, 'allow', permission)
      }
      permission['*'] = 'ask'
    }
    await save(permission)
  } catch (error) {
    Notice.show(error.message)
  } finally {
    busy.value = ''
  }
}

async function flipAll() {
  if (busy.value) return
  busy.value = '*'
  try {
    const base = store.config.raw?.permission || {}
    if (!masterOn.value) {
      // 全选只写全局 allow：一个键就让所有工具直接执行，不必逐个存规则。
      await save({ ...base, '*': 'allow' })
      return
    }
    // 全不选要让每个开关真的灭掉：只把全局改回 ask 的话，工具自己记住的 allow 还亮着。
    // 参数级规则原样保留，只把每个工具的默认动作改回 ask；明确拒绝本来就不算「开着」，留着。
    let permission = { ...base }
    for (const item of tools.value) {
      if (item.permission === 'deny') continue
      permission = permissionWith(item.name, 'ask', permission)
    }
    permission['*'] = 'ask'
    await save(permission)
  } catch (error) {
    Notice.show(error.message)
  } finally {
    busy.value = ''
  }
}

// 打开时把焦点交给万能开关，键盘能直接操作。
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
  const focusable = [...popup.value.querySelectorAll('button:not(:disabled)')]
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
      :aria-label="`工具自动批准（${allowedCount}/${tools.length} 已自动执行）`"
      aria-haspopup="dialog" :aria-expanded="open" :aria-controls="id"
      @click="toggle"
    >
      <Icon name="permission" :size="18" />
      <span class="composer-tools__count">{{ allowedCount }}/{{ tools.length }}</span>
    </button>

    <div
      :id="id" ref="popup" popover="auto" role="dialog" aria-label="工具自动批准"
      class="composer-tools__popup" :style="position"
      @toggle="handleToggle" @keydown="onKeydown"
    >
      <header class="composer-tools__head">
        <p class="composer-tools__title">工具自动批准</p>
      </header>

      <div v-if="tools.length" class="composer-tools__grid">
        <!-- 万能开关：跨两列摆在最上面，和下面的工具格子同一套开关语言。
             它就是全选：点一下把底下所有开关一起打开，再点一下一起关掉。
             文字固定，开没开由格子填充和右上角的计数说明，和下面每格一致。 -->
        <button
          type="button" class="composer-tools__tool composer-tools__tool--all"
          :class="{ 'is-on': masterOn }" :aria-pressed="masterOn ? 'true' : partial ? 'mixed' : 'false'"
          :disabled="busy === '*'" @click="flipAll"
        >
          <span class="composer-tools__check"><Icon :name="masterOn ? 'check' : partial ? 'minus' : 'info'" :size="14" /></span>
          <span class="composer-tools__name">全部自动执行</span>
        </button>

        <!-- 每个工具本身也是一个开关：点一下切换，不再拼「文字 + 右侧开关」两段式。 -->
        <button
          v-for="tool in tools" :key="tool.name" type="button"
          class="composer-tools__tool" :class="{ 'is-on': allowed(tool) }"
          :aria-pressed="allowed(tool)" :disabled="busy === tool.name"
          :title="`${tool.kindLabel || tool.kind} · ${tool.name}`"
          @click="flip(tool)"
        >
          <span class="composer-tools__check"><Icon :name="allowed(tool) ? 'check' : 'info'" :size="14" /></span>
          <span class="composer-tools__name">{{ tool.title || tool.name }}</span>
        </button>
      </div>
      <p v-else class="composer-tools__empty">暂无可配置的工具</p>

      <p class="composer-tools__hint">已自动执行的工具不再弹审批，其余每次调用前先问你。最上面一格一次改动下面所有开关。</p>
    </div>
  </span>
</template>

<style scoped lang="scss" src="../../styles/components/composer/ComposerTools.scss"></style>
