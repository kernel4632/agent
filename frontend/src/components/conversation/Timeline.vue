<!--
  会话时间线：按顺序显示消息、思考过程、工具调用与审批，以及回退和分支操作。
  只被会话页使用；会话从 store 读，滚动容器必须由调用方传入。
  用户消息和助手回复按轮排布；历史轮次由 virtua 虚拟化，最新几轮始终挂载。
  按钮和图标按钮走 ui/；右键直接进聚光引导（MessageActions 内置），回退确认也在同一张卡片里。
  调用示例：
  <Timeline :key="session.id" :scroll-root="conversationScroll" />
-->
<script setup>
import { History } from "../../features/history.js"
import { Navigation } from '../../commands/navigation.js'

import { Notice } from "../../utils/notice.js"
import { copyText } from '../../utils/clipboard.js'
import { readScroll, saveScroll } from '../../utils/session-view.js'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Virtualizer } from 'virtua/vue'
import { store } from '../../store.js'
import { groupMessageTurns } from "../../features/turns.js"
import { isSavedMessage } from "../../features/turns.js"
import Icon from '../../ui/Icon.vue'
import TurnItem from './TurnItem.vue'

const props = defineProps({
    // 滚动容器由页面显式传入，不在组件里靠 class 查找祖先。
    scrollRoot: { type: Object, default: null },
})
const session = computed(() => store.sessions[store.ui.activeSessionID])
const messages = computed(() => session.value?.messages || [])
// 一条用户消息和它后面自动接续的所有助手消息算一轮，头像和名字每轮只显示一次。
// 流式输出只改最后一轮；前面已经完成的轮次复用原对象，避免每个 token 都让整条时间线重渲染。
let turnCache = []
const turns = computed(() => {
  const next = groupMessageTurns(messages.value)
  const previous = turnCache
  const merged = next.map((turn, index) => {
    const old = previous[index]
    return old
      && old.id === turn.id
      && old.messages.length === turn.messages.length
      && old.messages.every((message, offset) => message === turn.messages[offset])
      ? old
      : turn
  })
  turnCache = merged
  return merged
})
// 全量数据留在内存，虚拟器只负责可见窗口；最新几轮始终挂载，流式行不会被回收。
const timelineSessionID = session.value?.id || ''
const LIVE_TAIL_TURNS = 3
const virtualCaches = new Map()
const initialVirtualCache = virtualCaches.get(timelineSessionID)
const historicalLength = Math.max(0, turns.value.length - LIVE_TAIL_TURNS)
const usableVirtualCache = Array.isArray(initialVirtualCache?.[0]) && initialVirtualCache[0].length === historicalLength
  ? initialVirtualCache
  : undefined
const virtualizer = ref(null)
const scrollElement = ref(null)
// 最新几轮放在虚拟窗口外，流式增长不会让虚拟器按“距底部距离”反复修正滚动。
const historicalTurns = computed(() => turns.value.slice(0, Math.max(0, turns.value.length - LIVE_TAIL_TURNS)))
const liveTurns = computed(() => turns.value.slice(Math.max(0, turns.value.length - LIVE_TAIL_TURNS)))
const itemProps = ({ item, index }) => ({
  class: 'conversation-flow__row',
  'data-turn-id': item.id,
  'data-index': index,
})
const savedView = readScroll(timelineSessionID)
const following = ref(savedView ? savedView.pinned : true)
const latestPosition = ref({ right: '24px', bottom: '96px' })
const rollbackTarget = ref(null)
const rollbackPreview = ref(null)
const flow = ref(null)
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

function onVirtualResize() {
  if (following.value) requestFollow()
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
  syncLatestPosition()
  rememberScroll()
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

// 全量挂载下直接按轮次 DOM 定位。
async function jumpToMessage(messageId) {
  const turnIndex = turns.value.findIndex(turn => turn.messages.some(message => message.id === messageId))
  if (turnIndex < 0) return
  beginJump()
  setFollowing(false)
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (virtualizer.value && turnIndex < historicalTurns.value.length) {
    virtualizer.value.scrollToIndex(turnIndex, { align: 'start', smooth: !reduce })
    // 目标行可能在虚拟窗口外，等它挂载后再按真实 DOM 校准一次。
    await new Promise(resolve => setTimeout(resolve, 180))
  }
  await nextTick()
  const element = scrollParent?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    || scrollParent?.querySelector(`[data-turn-id="${CSS.escape(turns.value[turnIndex].id)}"]`)
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
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!following.value || !virtualizer.value || !turns.value.length) return
        virtualizer.value.scrollToIndex(turns.value.length - 1, { align: 'end' })
      })
    })
  })
})
watch(() => props.scrollRoot, root => bindScrollRoot(root), { flush: 'post' })
onBeforeUnmount(() => {
  unbindScrollRoot()
  if (virtualizer.value && timelineSessionID) virtualCaches.set(timelineSessionID, virtualizer.value.cache)
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
  scrollElement.value = null
}

function bindScrollRoot(root) {
  // 会话切换时 Transition 可能先挂载新时间线、后交回滚动容器。
  if (!root || root === scrollParent) return
  if (scrollParent) unbindScrollRoot()
  scrollParent = root
  scrollElement.value = root
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
// 只回退后端存过的消息；pending 和本地错误消息没有可用的 messageId。
const canRollback = message => isSavedMessage(message)

// 右键打开聚光时就取代价预览：用户点“回退”切换到确认态时代价已经在了。
async function requestRollback(message) {
  if (!canRollback(message)) return
  rollbackTarget.value = message
  rollbackPreview.value = await History.previewRollback(session.value.id, message.id)
}
function clearRollback() {
  rollbackTarget.value = null
  rollbackPreview.value = null
}
async function confirmRollback(restoreFiles) {
  const sessionID = session.value.id
  if (session.value.status === 'running') {
    const { Chat } = await import('../../commands/chat.js')
    await Chat.stop(sessionID)
  }
  await History.rollbackMessage(sessionID, rollbackTarget.value?.id, restoreFiles)
  clearRollback()
}

// 从这条用户消息分出一个新对话，原对话不动。
async function forkFrom(message) {
  const id = await History.fork(session.value.id, message.id)
  if (id) await Navigation.openChat(id)
}

function userMenuItems(message) {
  const items = [{ value: 'copy', label: '复制消息', icon: 'copy' }]
  if (canRollback(message)) {
    items.push({ value: 'rollback', label: '回退到这条消息', icon: 'undo' })
    items.push({ value: 'fork', label: '从这里分支', icon: 'branch' })
  }
  return items
}

function onUserMenu(message, action) {
  if (action === 'copy') copyMessage(message.displayContent ?? message.content)
  else if (action === 'rollback') requestRollback(message)
  else if (action === 'fork') { clearRollback(); forkFrom(message) }
}

async function copyMessage(text) { Notice.show(await copyText(text) ? '已复制' : '复制失败'); }
</script>

<template>
  <div
    ref="flow"
    class="conversation-flow"
    role="log"
    aria-label="对话内容"
  >
    <Virtualizer
      ref="virtualizer"
      :data="historicalTurns"
      :scroll-ref="scrollElement"
      :buffer-size="2000"
      :item-props="itemProps"
      :cache="usableVirtualCache"
      class="conversation-flow__virtual"
      @resize="onVirtualResize"
    >
      <template #default="{ item: turn }">
        <TurnItem
          :turn="turn"
          :session-id="session.id"
          :running="session.status === 'running'"
          :active="false"
          :rollback-target="rollbackTarget"
          :rollback-preview="rollbackPreview"
          :menu-items="userMenuItems"
          @request-rollback="requestRollback"
          @close="clearRollback"
          @action="onUserMenu"
          @rollback-confirm="confirmRollback"
          @fork="forkFrom"
        />
      </template>
    </Virtualizer>
    <div
      v-for="turn in liveTurns"
      :key="turn.id"
      class="conversation-flow__row conversation-flow__row--tail"
      :data-turn-id="turn.id"
    >
      <TurnItem
        :turn="turn"
        :session-id="session.id"
        :running="session.status === 'running'"
        :active="session.status === 'running' && turn.id === turns.at(-1)?.id"
        :rollback-target="rollbackTarget"
        :rollback-preview="rollbackPreview"
        :menu-items="userMenuItems"
        @request-rollback="requestRollback"
        @close="clearRollback"
        @action="onUserMenu"
        @rollback-confirm="confirmRollback"
        @fork="forkFrom"
      />
    </div>
    <div v-if="!following" class="conversation-latest-layer" :style="latestPosition">
      <button type="button" class="conversation-latest" @click="jumpToBottom">
        <Icon name="down" :size="14" />
        回到最新
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/Timeline.scss"></style>
