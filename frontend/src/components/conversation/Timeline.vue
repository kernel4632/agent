<!--
  会话时间线：按顺序显示消息、思考过程、工具调用与审批，以及回退和分支操作。
  只被会话页使用；会话从 store 读，滚动容器必须由调用方传入。
  用户消息和助手回复按轮排布；历史按 compact 边界折叠，最后一次压缩之后始终展开。
  按钮和图标按钮走 ui/；右键和长按交还浏览器，步骤回退/分支由每条步骤左侧的窄条打开。
  调用示例：
  <Timeline :key="session.id" :scroll-root="conversationScroll" />
-->
<script setup>
import { History } from "../../features/history.js"
import { Navigation } from '../../commands/navigation.js'

import { Notice } from "../../utils/notice.js"
import { readScroll, saveScroll } from '../../utils/session-view.js'

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { store } from '../../store.js'
import { groupMessageTurns } from "../../features/turns.js"
import Icon from '../../ui/Icon.vue'
import Fold from '../../ui/Fold.vue'
import CompactionNotice from '../feedback/CompactionNotice.vue'
import StepActions from './StepActions.vue'
import TurnItem from './TurnItem.vue'

const props = defineProps({
    // 滚动容器由页面显式传入，不在组件里靠 class 查找祖先。
    scrollRoot: { type: Object, default: null },
})
const session = computed(() => store.sessions[store.ui.activeSessionID])
const messages = computed(() => session.value?.messages || [])
// compact 记录只增不减：每次流式增量只扫新追加的消息，折叠历史段不重算。
let compactCache = { source: null, scanned: 0, items: [] }
const compactItems = computed(() => {
  const list = messages.value
  if (compactCache.source !== list || list.length < compactCache.scanned) {
    compactCache = { source: list, scanned: 0, items: [] }
  }
  let changed = false
  for (let index = compactCache.scanned; index < list.length; index += 1) {
    if (list[index].compact) {
      compactCache.items.push({ message: list[index], index })
      changed = true
    }
  }
  compactCache.scanned = list.length
  // 数组内容变了要换一个新引用，否则下游 computed 看不到新 compact。
  if (changed) compactCache.items = [...compactCache.items]
  return compactCache.items
})
// 历史段只在出现新的 compact 时重建；流式输出只影响最后一段。
let historyCache = { source: null, items: null, blocks: [] }
const historyBlocks = computed(() => {
  const items = compactItems.value
  if (historyCache.source === messages.value && historyCache.items === items) return historyCache.blocks
  const list = messages.value
  const blocks = []
  let start = 0
  for (const item of items) {
    const segment = list.slice(start, item.index)
    const segmentTurns = groupMessageTurns(segment)
    if (segmentTurns.length) {
      blocks.push({
        type: 'history',
        id: `history-${item.message.id}`,
        turns: segmentTurns,
        count: segment.length,
        messages: segment,
      })
    }
    blocks.push({ type: 'compact', id: `compact-${item.message.id}`, message: item.message })
    start = item.index + 1
  }
  historyCache = { source: list, items, blocks }
  return blocks
})
const currentMessages = computed(() => {
  const last = compactItems.value.at(-1)
  return messages.value.slice(last ? last.index + 1 : 0)
})
const currentTurns = computed(() => groupMessageTurns(currentMessages.value))
const currentBlock = computed(() => currentTurns.value.length ? {
  type: 'current',
  id: 'current',
  turns: currentTurns.value,
  messages: currentMessages.value,
} : null)
const blocks = computed(() => {
  if (manifestBlocks.value) {
    return currentBlock.value ? [...manifestBlocks.value, currentBlock.value] : manifestBlocks.value
  }
  return currentBlock.value
    ? [...historyBlocks.value, currentBlock.value]
    : historyBlocks.value
})
const expandedHistory = reactive(new Set())
const loadingSegments = reactive(new Set())
const segmentTurnCache = new Map()
const compactBlockCache = new Map()

function turnsOfSegment(segment) {
  const loaded = session.value?.segmentMessages?.[segment.id]
  if (!Array.isArray(loaded)) return []
  const cached = segmentTurnCache.get(segment.id)
  if (cached?.source === loaded) return cached.turns
  const turns = groupMessageTurns(loaded)
  segmentTurnCache.set(segment.id, { source: loaded, turns })
  return turns
}

function compactOfSegment(segment) {
  if (compactBlockCache.has(segment.id)) return compactBlockCache.get(segment.id)
  const compact = History.normalizeCompact(segment.compact)
  compactBlockCache.set(segment.id, compact)
  return compact
}

const manifestBlocks = computed(() => {
  const segments = session.value?.historyManifest?.segments
  if (!Array.isArray(segments)) return null
  const list = []
  for (const segment of segments) {
    const turns = turnsOfSegment(segment)
    if (segment.count > 0) {
      list.push({
        type: 'history',
        id: segment.id,
        turns,
        count: segment.count,
        segment,
      })
    }
    const compact = compactOfSegment(segment)
    if (compact) list.push({ type: 'compact', id: `compact-${segment.id}`, message: compact })
  }
  return list
})
const timelineSessionID = session.value?.id || ''
const savedView = readScroll(timelineSessionID)
const following = ref(savedView ? savedView.pinned : true)
const latestPosition = ref({ right: '24px', bottom: '96px' })
const flow = ref(null)
// 全局只有一个步骤浮层；数据来自悬停步骤的 data-step-*，不占正文宽度。
const stepAction = reactive({
  visible: false,
  left: 0,
  top: 0,
  rollbackId: '',
  forkId: '',
  partIndex: undefined,
  kind: 'step',
  label: '步骤操作',
})
let stepActionElement = null
let stepActionTimer = 0
let stepActionBusy = false
let stepActionPinned = false
let scrollParent = null
let contentObserver = null
let followFrame = 0
let bottomTimer = 0
let jumpTimer = 0
let jumping = false
let saveTimer = 0
let pointerActive = false
let touchStartY = null
let touchStartTop = 0
let lastScrollTop = 0
let resumeFollow = false

const maxScrollTop = () => scrollParent ? Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight) : 0
const atBottom = (threshold = 8) => Boolean(scrollParent) && maxScrollTop() - scrollParent.scrollTop <= threshold

function scrollToLatest(behavior = 'auto') {
  if (!scrollParent) return
  scrollParent.scrollTo({ top: scrollParent.scrollHeight, behavior })
}

// 流式增长、工具卡展开都只通过 rAF 贴一次底；读者上滚后 following=false，这里不再抢滚动。
function requestFollow() {
  if (!following.value || followFrame) return
  followFrame = requestAnimationFrame(() => {
    followFrame = 0
    if (!following.value || !scrollParent) return
    const max = maxScrollTop()
    if (max > scrollParent.scrollTop + 1) scrollParent.scrollTop = max
  })
}

// “回到最新”用 fixed 覆盖在聊天区右下角，不能参与 flow 布局。
function syncLatestPosition() {
  if (!scrollParent || !flow.value || following.value) return
  const scrollRect = scrollParent.getBoundingClientRect()
  const flowRect = flow.value.getBoundingClientRect()
  const right = `${Math.max(12, window.innerWidth - flowRect.right + 8)}px`
  const bottom = `${Math.max(12, window.innerHeight - scrollRect.bottom + 12)}px`
  if (latestPosition.value.right === right && latestPosition.value.bottom === bottom) return
  latestPosition.value = { right, bottom }
}
watch(following, value => {
  if (!value) nextTick(syncLatestPosition)
})
watch(flow, element => {
  contentObserver?.disconnect()
  contentObserver = null
  if (!element) return
  contentObserver = new ResizeObserver(() => {
    // 流式正文、工具展开、代码块异步排版都会改内容高度；只读 following，
    // 读者一旦上滚就不再跟随。
    if (following.value) requestFollow()
    else syncLatestPosition()
  })
  contentObserver.observe(element)
}, { flush: 'post' })

// 记录当前视口最上方的轮次及其相对偏移；刷新后按“同一轮 + 同一偏移”恢复，
// 不拿会随 Markdown/图片高度变化的 scrollTop 当锚点。
function visibleAnchor() {
  if (!scrollParent) return null
  const rect = scrollParent.getBoundingClientRect()
  const element = [...scrollParent.querySelectorAll('[data-turn-id]')]
    .find(item => item.getBoundingClientRect().bottom > rect.top + 1)
  if (!element) return null
  return {
    id: element.getAttribute('data-turn-id') || '',
    offset: element.getBoundingClientRect().top - rect.top,
  }
}

// 滚动事件很密，先记在内存里，停手后再落一次 localStorage。
function rememberScroll() {
  if (!scrollParent || !timelineSessionID) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushScroll, 160)
}
function flushScroll() {
  clearTimeout(saveTimer)
  saveTimer = 0
  if (!scrollParent || !timelineSessionID) return
  const anchor = visibleAnchor()
  saveScroll(timelineSessionID, {
    top: scrollParent.scrollTop,
    anchorId: anchor?.id || '',
    anchorOffset: anchor?.offset || 0,
    pinned: following.value,
  })
}

async function toggleHistory(block) {
  const id = block.id
  if (expandedHistory.has(id)) {
    expandedHistory.delete(id)
    return
  }
  // manifest 段在第一次展开时才拉取；拉到之前保持折叠，不先撑开空白。
  if (block.segment && block.count > 0 && !block.turns.length) {
    loadingSegments.add(id)
    try {
      await History.loadSegment(session.value.id, id)
    } catch (error) {
      Notice.show(error.message)
      return
    } finally {
      loadingSegments.delete(id)
    }
  }
  expandedHistory.add(id)
}

function setFollowing(value) {
  if (!value) resumeFollow = false
  scrollParent?.classList.toggle('is-following', value)
  following.value = Boolean(value)
  if (value) requestFollow()
}

// 跳转期间不接受滚轮/程序滚动的跟随判定；结束后重新根据是否到底决定。
function beginJump() {
  jumping = true
  clearTimeout(jumpTimer)
  jumpTimer = window.setTimeout(() => {
    jumping = false
    if (!scrollParent) return
    following.value = atBottom()
    scrollParent.classList.toggle('is-following', following.value)
    rememberScroll()
  }, 1500)
}
function endJump() {
  jumping = false
  clearTimeout(jumpTimer)
  jumpTimer = 0
}

// 滚动容器里可能还有代码块等内部滚动区；它们消费掉的滚轮不算读者的聊天上滚。
function nestedScroller(target) {
  let element = target instanceof Element ? target : null
  while (element && element !== scrollParent) {
    const style = getComputedStyle(element)
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) return element
    element = element.parentElement
  }
  return null
}

function onScroll() {
  if (!scrollParent) return
  const top = scrollParent.scrollTop
  if (!jumping) {
    const atEnd = atBottom()
    // 内容测量/虚拟器自身调整也会触发 scroll，不能把它当用户上滚；
    // 只有按住指针或滚轮/触摸明确上滚时才关闭跟随。
    if (pointerActive && top < lastScrollTop - 1) setFollowing(false)
    else if (atEnd && (resumeFollow || pointerActive)) setFollowing(true)
  }
  lastScrollTop = top
  positionStepAction()
  syncLatestPosition()
  rememberScroll()
}

function positionStepAction() {
  if (!stepAction.visible || !stepActionElement?.isConnected) return
  const rect = stepActionElement.getBoundingClientRect()
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    hideStepAction()
    return
  }
  // 对齐到这一行自己的图标；没有图标的用户消息按行顶对齐。
  const icon = stepActionElement.querySelector('.cot-step__icon, .request-status__icon, .context-group__icon')
  const anchor = icon ? icon.getBoundingClientRect() : rect
  const anchorTop = icon ? anchor.top + anchor.height / 2 : anchor.top + 8
  // 桌面放在行图标左侧的空白；手机没有空白，浮层缩成图标大小盖在原图标上，不挤正文。
  stepAction.left = window.innerWidth < 768
    ? Math.max(4, anchor.left - 4)
    : Math.max(8, anchor.left - 64)
  stepAction.top = Math.max(8, Math.min(window.innerHeight - 52, anchorTop - 17))
}

function showStepAction(element) {
  if (!element) return
  const part = element.getAttribute('data-cut-part-index')
  const partIndex = part === null || part === '' ? undefined : Number(part)
  const rollbackId = element.getAttribute('data-cut-message-id') || ''
  const forkId = rollbackId
  if (!rollbackId) return
  clearTimeout(stepActionTimer)
  stepActionElement = element
  stepAction.rollbackId = rollbackId
  stepAction.forkId = forkId
  stepAction.partIndex = Number.isInteger(partIndex) ? partIndex : undefined
  stepAction.kind = element.getAttribute('data-cut-kind') || 'step'
  stepAction.label = element.getAttribute('data-cut-label') || '步骤操作'
  stepAction.visible = true
  positionStepAction()
}

function hideStepAction() {
  clearTimeout(stepActionTimer)
  stepAction.visible = false
  stepActionElement = null
  stepActionPinned = false
}

function scheduleHideStepAction(delay = 220) {
  if (stepActionBusy) return
  clearTimeout(stepActionTimer)
  stepActionTimer = window.setTimeout(hideStepAction, delay)
}

function onStepPointerOver(event) {
  if (event.target.closest?.('.step-actions-float')) {
    clearTimeout(stepActionTimer)
    return
  }
  const element = event.target.closest?.('[data-cut-row]')
  if (element) {
    // 点击选中后，后续 hover 不能再把目标换成布局移动后落到鼠标下的另一行。
    if (stepActionPinned && stepAction.visible) return
    showStepAction(element)
  } else scheduleHideStepAction()
}

function onStepPointerLeave(event) {
  // 触摸抬起后浏览器会补一个 pointerleave；这不是用户移开，不能把刚点出的操作块收掉。
  if (event.pointerType && event.pointerType !== 'mouse') return
  scheduleHideStepAction(260)
}

function onStepPointerDown(event) {
  if (event.target.closest?.('.step-actions-float')) return
  const element = event.target.closest?.('[data-cut-row]')
  if (element) {
    stepActionPinned = true
    showStepAction(element)
  }
}

function onStepActionEnter() {
  clearTimeout(stepActionTimer)
}

function onStepActionBusy(value) {
  stepActionBusy = value
  if (value) clearTimeout(stepActionTimer)
}

function onStepActionLeave(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return
  scheduleHideStepAction(180)
}

function onDocumentPointerDown(event) {
  if (!stepAction.visible) return
  if (event.target.closest?.('[data-cut-row]')
    || event.target.closest?.('.step-actions-float')
    || event.target.closest?.('.ui-dialog')) return
  hideStepAction()
}

function onDocumentPointerMove(event) {
  if (!stepAction.visible) return
  if (event.target.closest?.('.step-actions-float') || event.target.closest?.('.ui-dialog')) {
    clearTimeout(stepActionTimer)
  }
}

function onViewportResize() {
  positionStepAction()
}


function onWheel(event) {
  if (!scrollParent) return
  if (scrollParent.scrollHeight <= scrollParent.clientHeight) return
  const nested = nestedScroller(event.target)
  if (nested) {
    if (event.deltaY < 0 && nested.scrollTop > 0) return
    if (event.deltaY > 0 && nested.scrollTop + nested.clientHeight < nested.scrollHeight - 1) return
  }
  if (event.deltaY < 0) {
    setFollowing(false)
  } else if (event.deltaY > 0) {
    resumeFollow = true
    if (atBottom()) setFollowing(true)
  }
}

function onPointerDown(event) {
  pointerActive = !nestedScroller(event.target)
}
function onPointerUp() {
  pointerActive = false
}

function onTouchStart(event) {
  touchStartY = null
  if (!scrollParent || nestedScroller(event.target)) return
  const touch = event.touches?.[0]
  if (!touch) return
  touchStartY = touch.clientY
  touchStartTop = scrollParent.scrollTop
}
function onTouchMove(event) {
  if (touchStartY == null || !scrollParent) return
  const touch = event.touches?.[0]
  if (!touch) return
  const distance = touch.clientY - touchStartY
  if (distance > 8 && scrollParent.scrollTop <= touchStartTop + 1) {
    setFollowing(false)
  } else if (distance < -8) {
    resumeFollow = true
    if (atBottom()) setFollowing(true)
  }
}
function onTouchEnd() {
  touchStartY = null
}

function onKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (!['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
  const active = document.activeElement
  const inside = scrollParent?.contains(active) || active === document.body
    || (target instanceof Node && scrollParent?.contains(target))
  if (!inside) return
  if (['PageUp', 'Home', 'ArrowUp'].includes(event.key)) {
    setFollowing(false)
    return
  }
  if (event.key === 'End') {
    jumpToBottom()
    return
  }
  resumeFollow = true
  requestAnimationFrame(() => {
    if (atBottom()) setFollowing(true)
  })
}

// 展开旧工具/思考卡片属于浏览历史，不应再被下一段流式输出拽回底部。
function onClick(event) {
  const head = event.target instanceof Element ? event.target.closest('.cot-step__head') : null
  if (head && scrollParent?.contains(head)) setFollowing(false)
}

function jumpToBottom() {
  if (!scrollParent) return
  beginJump()
  setFollowing(true)
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  scrollToLatest(reduce ? 'auto' : 'smooth')
  // 平滑滚动期间 Markdown/图片还会继续排版，目标高度会变；落定后再补一次，
  // 否则“回到最新”可能停在离底部一百多像素的位置。
  clearTimeout(bottomTimer)
  bottomTimer = window.setTimeout(() => {
    if (following.value) scrollToLatest('auto')
  }, 700)
}

// 目标消息可能在折叠历史里：先展开所属段，再按真实 DOM 定位。
async function jumpToMessage(messageId, targetIndex) {
  let targetTurn = [...historyBlocks.value.flatMap(block => block.turns), ...currentTurns.value]
    .find(turn => turn.messages.some(message => message.id === messageId))
  const manifest = session.value?.historyManifest
  let hiddenBlock = blocks.value.find(block => block.type === 'history'
    && !expandedHistory.has(block.id)
    && (block.messages?.some(message => message.id === messageId)
      || block.segment?.messageIds?.includes(messageId)
      || (targetIndex != null && block.segment
        && targetIndex >= block.segment.startIndex
        && targetIndex <= block.segment.compactIndex)))
  if (hiddenBlock?.segment) {
    // 段内消息按需加载；加载完再从真实 turn 里找目标。
    if (!hiddenBlock.turns.length) await History.loadSegment(session.value.id, hiddenBlock.id)
    expandedHistory.add(hiddenBlock.id)
    await nextTick()
    targetTurn = turnsOfSegment(hiddenBlock.segment)
      .find(turn => turn.messages.some(message => message.id === messageId)) || targetTurn
  } else if (hiddenBlock) {
    expandedHistory.add(hiddenBlock.id)
    await nextTick()
  } else if (!targetTurn && manifest) {
    // 搜索等入口可能只给 id；按已经加载的段找不到时，退回全段顺序找一次。
    for (const segment of manifest.segments) {
      if (!session.value.segmentMessages?.[segment.id]) await History.loadSegment(session.value.id, segment.id)
      const turns = turnsOfSegment(segment)
      const found = turns.find(turn => turn.messages.some(message => message.id === messageId))
      if (found) {
        expandedHistory.add(segment.id)
        targetTurn = found
        await nextTick()
        break
      }
    }
  }
  if (!targetTurn && !messageId) return
  beginJump()
  setFollowing(false)
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  await nextTick()
  const element = scrollParent?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    || (targetTurn && scrollParent?.querySelector(`[data-turn-id="${CSS.escape(targetTurn.id)}"]`))
  if (!element || !scrollParent) return
  const top = element.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top + scrollParent.scrollTop
  scrollParent.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
  const targetId = messageId
  const stabilize = (remaining = 8) => {
    window.setTimeout(() => {
      if (!remaining || !scrollParent) return
      const current = scrollParent.querySelector(`[data-message-id="${CSS.escape(targetId)}"]`)
      if (current) {
        const delta = current.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top
        if (Math.abs(delta) > 2) scrollParent.scrollTop += delta
      }
      stabilize(remaining - 1)
    }, 120)
  }
  stabilize()
}
defineExpose({ jumpToMessage, jumpToBottom })

onMounted(() => {
  bindScrollRoot(props.scrollRoot)
  document.addEventListener('pointerdown', onDocumentPointerDown, { passive: true })
  document.addEventListener('pointermove', onDocumentPointerMove, { passive: true })
  window.addEventListener('resize', onViewportResize)
})
watch(() => props.scrollRoot, root => bindScrollRoot(root), { flush: 'post' })
onBeforeUnmount(() => {
  unbindScrollRoot()
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('pointermove', onDocumentPointerMove)
  window.removeEventListener('resize', onViewportResize)
  clearTimeout(stepActionTimer)
  clearTimeout(jumpTimer)
  clearTimeout(saveTimer)
  clearTimeout(bottomTimer)
  if (followFrame) cancelAnimationFrame(followFrame)
})

function unbindScrollRoot() {
  if (!scrollParent) return
  flushScroll()
  scrollParent.removeEventListener('scroll', onScroll)
  scrollParent.removeEventListener('wheel', onWheel)
  scrollParent.removeEventListener('pointerdown', onPointerDown)
  scrollParent.removeEventListener('touchstart', onTouchStart)
  scrollParent.removeEventListener('touchmove', onTouchMove)
  scrollParent.removeEventListener('touchend', onTouchEnd)
  scrollParent.removeEventListener('touchcancel', onTouchEnd)
  scrollParent.removeEventListener('click', onClick)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pagehide', flushScroll)
  contentObserver?.disconnect()
  contentObserver = null
  scrollParent = null
}

function bindScrollRoot(root) {
  // 会话切换时 Transition 可能先挂载新时间线、后交回滚动容器。
  if (!root || root === scrollParent) return
  if (scrollParent) unbindScrollRoot()
  scrollParent = root
  scrollParent.classList.toggle('is-following', following.value)
  scrollParent.addEventListener('scroll', onScroll, { passive: true })
  scrollParent.addEventListener('wheel', onWheel, { passive: true })
  scrollParent.addEventListener('pointerdown', onPointerDown, { passive: true })
  scrollParent.addEventListener('touchstart', onTouchStart, { passive: true })
  scrollParent.addEventListener('touchmove', onTouchMove, { passive: true })
  scrollParent.addEventListener('touchend', onTouchEnd, { passive: true })
  scrollParent.addEventListener('touchcancel', onTouchEnd, { passive: true })
  scrollParent.addEventListener('click', onClick)
  window.addEventListener('pointerup', onPointerUp, { passive: true })
  window.addEventListener('pointercancel', onPointerUp, { passive: true })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pagehide', flushScroll)

  requestAnimationFrame(() => {
    if (!scrollParent) return
    const restoreTop = savedView && savedView.pinned === false && Number.isFinite(savedView.top) ? savedView.top : null
    if (restoreTop == null) {
      scrollToLatest()
    } else {
      const anchor = savedView.anchorId && scrollParent.querySelector(`[data-turn-id="${CSS.escape(savedView.anchorId)}"]`)
      if (anchor) {
        const currentOffset = anchor.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top
        scrollParent.scrollTop += currentOffset - savedView.anchorOffset
      } else {
        scrollParent.scrollTop = restoreTop
      }
    }
    requestAnimationFrame(() => {
      if (!scrollParent) return
      // 完整历史一次到位；这里只恢复位置或贴底，不再补页。
      following.value = atBottom()
      scrollParent.classList.toggle('is-following', following.value)
      syncLatestPosition()
    })
  })
}
// 步骤操作：回退从步骤第一条消息开始，分支保留到步骤最后一条消息。
async function rollbackStep({ id, message, partIndex, files = true } = {}) {
  const messageId = id || message?.id
  if (!messageId) return
  const sessionID = session.value.id
  if (session.value.status === 'running') {
    const { Chat } = await import('../../commands/chat.js')
    await Chat.stop(sessionID)
  }
  hideStepAction()
  await History.rollbackMessage(sessionID, messageId, files, partIndex)
}

async function forkStep(idOrMessage) {
  const messageId = typeof idOrMessage === 'string' ? idOrMessage : idOrMessage?.id
  if (!messageId) return
  hideStepAction()
  const id = await History.fork(session.value.id, messageId)
  if (id) await Navigation.openChat(id)
}
</script>

<template>
  <div
    ref="flow"
    class="conversation-flow"
    role="log"
    aria-label="对话内容"
    @pointerover="onStepPointerOver"
    @pointerdown="onStepPointerDown"
    @pointerleave="onStepPointerLeave"
  >
    <template v-for="block in blocks" :key="block.id">
      <section v-if="block.type === 'history'" class="history-fold">
        <button type="button" class="history-fold__head" :aria-expanded="expandedHistory.has(block.id)" @click="toggleHistory(block)">
          <span class="history-fold__icon"><Icon name="layers" :size="15" /></span>
          <span class="history-fold__title">已折叠的历史</span>
          <span class="history-fold__meta">{{ block.turns.length ? `${block.turns.length} 轮 · ` : '' }}{{ block.count }} 条{{ loadingSegments.has(block.id) ? ' · 加载中…' : '' }}</span>
          <Icon name="down" :size="14" class="history-fold__caret" :class="{ 'is-open': expandedHistory.has(block.id) }" aria-hidden="true" />
        </button>
        <Fold :open="expandedHistory.has(block.id)">
          <div class="history-fold__body">
            <div v-for="turn in block.turns" :key="turn.id" class="conversation-flow__row" :data-turn-id="turn.id">
              <TurnItem
                :turn="turn"
                :session-id="session.id"
                :active="false"
              />
            </div>
          </div>
        </Fold>
      </section>
      <div v-else-if="block.type === 'compact'" class="timeline-compaction" :data-message-id="block.message.id">
        <CompactionNotice :content="block.message.content" />
      </div>
      <template v-else>
        <div v-for="turn in block.turns" :key="turn.id" class="conversation-flow__row" :data-turn-id="turn.id">
          <TurnItem
            :turn="turn"
            :session-id="session.id"
            :active="session.status === 'running' && turn.id === currentTurns.at(-1)?.id"
          />
        </div>
      </template>
    </template>
    <div v-if="!following" class="conversation-latest-layer" :style="latestPosition">
      <button type="button" class="conversation-latest" @click="jumpToBottom">
        <Icon name="down" :size="14" />
        回到最新
      </button>
    </div>
  </div>
  <div class="step-action-anchor" @pointerenter="onStepActionEnter" @pointerleave="onStepActionLeave">
    <StepActions
      :visible="stepAction.visible"
      :left="stepAction.left"
      :top="stepAction.top"
      :rollback-id="stepAction.rollbackId"
      :fork-id="stepAction.forkId"
      :part-index="stepAction.partIndex"
      :kind="stepAction.kind"
      :label="stepAction.label"
      :running="session.status === 'running'"
      @rollback="rollbackStep"
      @fork="forkStep"
      @busy="onStepActionBusy"
    />
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/Timeline.scss"></style>
