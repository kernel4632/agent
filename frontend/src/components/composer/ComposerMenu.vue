<!--
输入区选项：一个按钮打开模型和推理强度，鼠标悬停展开二级窗。
模型来自 providers，选中后走 choose-model；推理强度只通过 update:reasoning 交给外面保存。
没有可用模型时，二级窗里给出「管理模型」入口；窄屏下二级窗改为盖住一层菜单。
调用示例：
<ComposerMenu :providers="providers" :model="model" :provider="provider" :reasoning="reasoning"
  @choose-model="chooseModel" @update:reasoning="saveReasoning" @configure="openModelSettings" />
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import Icon from '../../ui/Icon.vue'

// 思考强度的七档：顺序、中文名、图标和一句说明都只在这里定义。
const REASONING_LEVELS = [
  { value: 'off', label: '关闭', short: '关', icon: 'thinking-off', hint: '不请求模型思考，回答最快' },
  { value: 'auto', label: '自动', short: '自动', icon: 'thinking-auto', hint: '不额外设置，交给模型自己决定' },
  { value: 'low', label: '轻', short: '轻', icon: 'thinking-low', hint: '适合简单问题，少花一点时间' },
  { value: 'medium', label: '中', short: '中', icon: 'thinking-medium', hint: '日常任务的默认档位' },
  { value: 'high', label: '重', short: '重', icon: 'thinking-high', hint: '复杂问题，允许更长的推理' },
  { value: 'xhigh', label: '极高', short: '极高', icon: 'thinking-xhigh', hint: '长链路任务，思考预算更大' },
  { value: 'max', label: '最大', short: '最大', icon: 'thinking-max', hint: '最慢，也最深入；只留给真正难的问题' },
]
const reasoningOf = value => REASONING_LEVELS.find(item => item.value === value) || REASONING_LEVELS[1]

const props = defineProps({
  providers: { type: Object, default: () => ({}) },
  model: { type: String, default: '' },
  provider: { type: String, default: '' },
  reasoning: { type: String, default: 'auto' },
})
const emit = defineEmits(['choose-model', 'update:reasoning', 'configure'])

const id = useId()
const trigger = ref(null)
const popup = ref(null)
const modelRow = ref(null)
const reasoningRow = ref(null)
const open = ref(false)
const sub = ref('')                 // 空字符串表示只显示一层菜单
const side = ref('right')           // 二级窗在菜单右侧还是左侧
const compact = ref(false)          // 窄屏下二级窗盖住一层菜单
const position = ref({})
let closeTimer = 0
let media

const currentReasoning = computed(() => reasoningOf(props.reasoning))
const triggerLabel = computed(() => `模型与推理（当前 ${props.model || '未选择模型'}，思考强度：${currentReasoning.value.label}）`)
// 按供应商分组，只保留启用且有模型的那些。
const groups = computed(() => Object.entries(props.providers || {})
  .filter(([, config]) => config?.enabled)
  .map(([provider, config]) => ({ provider, models: (config.models || []).map(item => item.id) }))
  .filter(group => group.models.length))

const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

// --- 贴着按钮放置：底部放不下就翻到上方，左右不越出屏幕 ---
function place() {
  if (!popup.value || !trigger.value) return
  const box = trigger.value.getBoundingClientRect()
  const width = popup.value.offsetWidth
  const height = popup.value.offsetHeight
  const left = clamp(box.left, 12, innerWidth - width - 12)
  const above = box.top - height - 8
  const top = above >= 12 ? above : Math.max(12, Math.min(box.bottom + 8, innerHeight - height - 12))
  position.value = { left: `${left}px`, top: `${top}px` }
  // 右边放不下 300px 的二级窗就翻到左边。
  side.value = innerWidth - left - width - 20 >= 300 ? 'right' : 'left'
}

function onMediaChange(event) {
  compact.value = event.matches
  if (open.value) nextTick(place)
}

async function show() {
  if (open.value) return
  popup.value.showPopover()
  open.value = true
  await nextTick()
  place()
}

function hide(restore = true) {
  clearTimeout(closeTimer)
  sub.value = ''
  popup.value?.hidePopover()
  open.value = false
  if (restore) trigger.value?.focus()
}

function onToggle(event) {
  open.value = event.newState === 'open'
  if (!open.value) {
    sub.value = ''
    return
  }
  // 等浏览器的 popover 焦点修复跑完，再把焦点交给第一行。
  nextTick(() => {
    place()
    modelRow.value?.focus()
  })
}

function toggle() { open.value ? hide() : show() }

// --- 悬停展开二级窗；留一点时间给鼠标跨过中间的空隙 ---
function showSub(kind) {
  clearTimeout(closeTimer)
  if (sub.value === kind) return
  sub.value = kind
  nextTick(place)
}
function keepSub() { clearTimeout(closeTimer) }
function leaveSub() {
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => { sub.value = '' }, 140)
}

// 窄屏的二级窗会盖住一层菜单，鼠标移上去就展开会把点击目标挡掉；那里只认点击。
function hoverSub(kind) {
  if (!compact.value) showSub(kind)
}

function chooseModel(provider, model) {
  hide(false)
  emit('choose-model', provider, model)
  nextTick(() => trigger.value?.focus())
}

function chooseReasoning(level) {
  hide(false)
  if (level.value !== props.reasoning) emit('update:reasoning', level.value)
  nextTick(() => trigger.value?.focus())
}

function manage() {
  hide(false)
  emit('configure')
}

// --- 键盘：上下选行，右方向键进二级窗，Esc 先退二级窗再关菜单 ---
function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    const kind = sub.value
    if (kind) {
      sub.value = ''
      ;(kind === 'model' ? modelRow : reasoningRow).value?.focus()
    } else hide()
    return
  }
  if (event.key === 'Tab') {
    // 菜单内部照常 Tab；走到第一个或最后一个再按才关闭，焦点交回输入区。
    const focusable = [...popup.value.querySelectorAll('button:not(:disabled)')].filter(element => element.getClientRects().length)
    const edge = event.shiftKey ? focusable[0] : focusable.at(-1)
    if (document.activeElement === edge) { event.preventDefault(); hide() }
    return
  }
  if (sub.value) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const rows = [modelRow.value, reasoningRow.value].filter(Boolean)
    const index = rows.indexOf(document.activeElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    rows[(index + step + rows.length) % rows.length]?.focus()
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    const kind = document.activeElement === reasoningRow.value ? 'reasoning' : 'model'
    showSub(kind)
    nextTick(() => popup.value?.querySelector('.composer-menu__sub button')?.focus())
  }
}

watch(sub, () => { if (open.value) nextTick(place) })

onMounted(() => {
  media = window.matchMedia('(max-width: 720px)')
  compact.value = media.matches
  media.addEventListener('change', onMediaChange)
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
})
onBeforeUnmount(() => {
  media?.removeEventListener('change', onMediaChange)
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
  clearTimeout(closeTimer)
})
</script>

<template>
  <span class="composer-menu">
    <button
      ref="trigger" type="button" class="composer-menu__trigger"
      :aria-label="triggerLabel" aria-haspopup="menu" :aria-expanded="open" :aria-controls="id"
      @click="toggle" @keydown.down.prevent="show"
    >
      <Icon name="model" :size="22" />
      <span class="composer-menu__model">{{ model || '未选择模型' }}</span>
      <span class="composer-menu__reasoning">{{ currentReasoning.short }}</span>
    </button>

    <div
      :id="id" ref="popup" popover="auto" role="menu" aria-label="模型与推理"
      class="composer-menu__popup" :class="{ 'is-compact': compact }"
      :style="position" @toggle="onToggle" @keydown="onKeydown"
    >
      <div v-show="!compact || !sub" class="composer-menu__list">
        <button
          ref="modelRow" type="button" role="menuitem" class="composer-menu__row" :class="{ 'is-active': sub === 'model' }"
          aria-haspopup="menu" :aria-expanded="sub === 'model'"
          @mouseenter="hoverSub('model')" @mouseleave="leaveSub" @click="showSub('model')"
        >
          <span class="composer-menu__row-icon"><Icon name="model" :size="20" /></span>
          <span class="composer-menu__row-text"><strong>切换模型</strong><small>{{ model || '还没有选择模型' }}</small></span>
          <Icon name="arrow" :size="16" class="composer-menu__chevron" />
        </button>
        <button
          ref="reasoningRow" type="button" role="menuitem" class="composer-menu__row" :class="{ 'is-active': sub === 'reasoning' }"
          aria-haspopup="menu" :aria-expanded="sub === 'reasoning'"
          @mouseenter="hoverSub('reasoning')" @mouseleave="leaveSub" @click="showSub('reasoning')"
        >
          <span class="composer-menu__row-icon"><Icon :name="currentReasoning.icon" :size="20" /></span>
          <span class="composer-menu__row-text"><strong>推理强度</strong><small>{{ currentReasoning.label }}</small></span>
          <Icon name="arrow" :size="16" class="composer-menu__chevron" />
        </button>
      </div>

      <div
        v-if="sub" class="composer-menu__sub" :class="`is-${side}`" role="menu"
        :aria-label="sub === 'model' ? '选择模型' : '推理强度'"
        @mouseenter="keepSub" @mouseleave="leaveSub"
      >
        <button v-if="compact" type="button" class="composer-menu__back" @click="sub = ''">
          <Icon name="arrow" :size="16" class="is-back" />返回
        </button>

        <template v-if="sub === 'model'">
          <p class="composer-menu__heading">选择模型</p>
          <template v-if="groups.length">
            <section v-for="group in groups" :key="group.provider" class="composer-menu__group">
              <p class="composer-menu__provider">{{ group.provider }}</p>
              <button
                v-for="item in group.models" :key="`${group.provider}:${item}`" type="button" role="menuitemradio"
                class="composer-menu__option" :class="{ 'is-selected': group.provider === provider && item === model }"
                :aria-label="item" :aria-checked="group.provider === provider && item === model"
                @click="chooseModel(group.provider, item)"
              >
                <span class="composer-menu__option-icon"><Icon name="model" :size="20" /></span>
                <span class="composer-menu__option-text">{{ item }}</span>
                <Icon v-if="group.provider === provider && item === model" name="check" :size="18" />
              </button>
            </section>
          </template>
          <p v-else class="composer-menu__empty">还没有可用模型。</p>
          <button type="button" class="composer-menu__manage" @click="manage">管理模型</button>
        </template>

        <template v-else>
          <p class="composer-menu__heading">推理强度</p>
          <button
            v-for="level in REASONING_LEVELS" :key="level.value" type="button" role="menuitemradio"
            class="composer-menu__option composer-menu__option--reasoning" :class="{ 'is-selected': level.value === reasoning }"
            :aria-label="level.label" :aria-checked="level.value === reasoning" @click="chooseReasoning(level)"
          >
            <span class="composer-menu__option-icon"><Icon :name="level.icon" :size="20" /></span>
            <span class="composer-menu__option-text"><strong>{{ level.label }}</strong><small>{{ level.hint }}</small></span>
            <Icon v-if="level.value === reasoning" name="check" :size="18" />
          </button>
        </template>
      </div>
    </div>
  </span>
</template>

<style scoped lang="scss" src="../../styles/components/composer/ComposerMenu.scss"></style>
