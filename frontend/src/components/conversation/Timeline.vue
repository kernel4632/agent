<!--
  会话时间线：按顺序显示消息、思考过程、工具调用与审批，以及回退和分支操作。
  只被会话页使用；会话从 store 读，滚动容器必须由调用方传入。
  用户消息和助手回复按轮排布；虚拟滚动和端锚定由 TanStack Virtual 负责。
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

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { store } from '../../store.js'
import { groupMessageTurns } from "../../features/turns.js"
import { isSavedMessage } from "../../features/turns.js"
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import MessageActions from './MessageActions.vue'
import CompactionNotice from '../feedback/CompactionNotice.vue'

import AssistantTurn from './AssistantTurn.vue'

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
const turnCount = computed(() => turns.value.length)
// 只让轮次结构（数量、id）驱动虚拟器配置；正文增长不会重建 options。
const turnRevision = computed(() => {
  let signature = `${turns.value.length}:`
  for (const turn of turns.value) signature += `${turn.id},`
  return signature
})
const timelineSessionID = session.value?.id || ''
const savedView = readScroll(timelineSessionID)
const following = ref(savedView ? savedView.pinned : true)
const latestPosition = ref({ right: '24px', bottom: '96px' })
const rollbackTarget = ref(null)
const rollbackPreview = ref(null)
const flow = ref(null)
const scrollElement = shallowRef(null)
let scrollParent = null
let jumpTimer = 0
let jumping = false
let saveTimer = 0
let pointerActive = false
let touchStartY = null
let touchStartTop = 0
let resumeFollow = false
let loadingEarlier = false
let restoringHistory = false

async function restoreLatestHistory() {
  if (restoringHistory || !scrollParent || !session.value?.temporaryHistory) return
  restoringHistory = true
  try {
    const restored = History.restoreRecent(session.value.id)
    if (!restored) await History.refresh(session.value.id)
    await nextTick()
    // 在浏览器绘制前直接换回最近窗口并贴底，避免中间帧出现旧高度。
    virtualizer.value.measure()
    virtualizer.value.scrollToEnd({ behavior: 'auto' })
    setFollowing(true)
  } finally {
    restoringHistory = false
  }
}

async function loadEarlier() {
  if (loadingEarlier || !scrollParent || !session.value || following.value) return
  if (!Number.isInteger(session.value.historyStart) || session.value.historyStart <= 0) return
  loadingEarlier = true
  const beforeHeight = scrollParent.scrollHeight
  const beforeTop = scrollParent.scrollTop
  try {
    const loaded = await History.loadOlder(session.value.id)
    if (!loaded) return
    await nextTick()
    requestAnimationFrame(() => {
      if (!scrollParent) return
      scrollParent.scrollTop = beforeTop + (scrollParent.scrollHeight - beforeHeight)
    })
  } finally {
    loadingEarlier = false
  }
}

// 按轮虚拟化：data 是完整轮次数组，虚拟器只挂载视口附近的行。
// anchorTo: 'end' + followOnAppend 让贴底时的流式增长和追加都自动保持在末尾，
// 不再手写 scrollHeight / scrollTop 补偿。
const getItemKey = index => turns.value[index]?.id ?? index
const virtualizerOptions = computed(() => {
  turnRevision.value // 只有轮次结构变化才重新配置虚拟器
  return {
    count: turnCount.value,
    getScrollElement: () => scrollElement.value,
    estimateSize: () => 220,
    getItemKey,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 8,
    overscan: 6,
    initialOffset: () => savedView && savedView.pinned === false && Number.isFinite(savedView.top)
      ? savedView.top
      : 0,
  }
})
const virtualizer = useVirtualizer(virtualizerOptions)
const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())
// 虚拟项变化时尽量复用行对象，让已经稳定的历史轮次跳过组件更新。
let rowCache = new Map()
const rows = computed(() => {
  const next = []
  const seen = new Set()
  for (const item of virtualItems.value) {
    const turn = turns.value[item.index]
    if (!turn) continue
    const cacheKey = `${item.index}:${item.key}`
    const previous = rowCache.get(cacheKey)
    const row = previous && previous.turn === turn && previous.item.start === item.start ? previous : { item, turn }
    rowCache.set(cacheKey, row)
    seen.add(cacheKey)
    next.push(row)
  }
  for (const key of rowCache.keys()) {
    if (!seen.has(key)) rowCache.delete(key)
  }
  return next
})
const measureElement = element => {
  if (element) virtualizer.value.measureElement(element)
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
  saveScroll(timelineSessionID, {
    top: scrollParent.scrollTop,
    pinned: following.value,
  })
}

function setFollowing(value) {
  if (!value) resumeFollow = false
  scrollParent?.classList.toggle('is-following', value)
  following.value = Boolean(value)
}

// 跳转期间不接受滚轮/程序滚动的跟随判定；结束后重新根据是否到底决定。
function beginJump() {
  jumping = true
  clearTimeout(jumpTimer)
  jumpTimer = window.setTimeout(() => {
    jumping = false
    if (!scrollParent) return
    following.value = virtualizer.value.isAtEnd(8)
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
  if (!jumping) {
    const atEnd = virtualizer.value.isAtEnd(8)
    if (atEnd && session.value?.temporaryHistory) void restoreLatestHistory()
    else if (!atEnd && following.value) setFollowing(false)
    else if (atEnd && (resumeFollow || pointerActive)) setFollowing(true)
    if (scrollParent.scrollTop < 160) void loadEarlier()
  }
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
  if (event.deltaY < 0) setFollowing(false)
  else if (event.deltaY > 0) {
    resumeFollow = true
    if (virtualizer.value.isAtEnd(8)) setFollowing(true)
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
  if (distance > 8 && scrollParent.scrollTop <= touchStartTop + 1) setFollowing(false)
  else if (distance < -8) {
    resumeFollow = true
    if (virtualizer.value.isAtEnd(8)) setFollowing(true)
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
    if (virtualizer.value.isAtEnd(8)) setFollowing(true)
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
  virtualizer.value.scrollToEnd({ behavior: reduce ? 'auto' : 'smooth' })
}

// 定位条跳转：虚拟器按稳定 key 直接滚到目标轮次，不依赖目标是否已挂载。
function jumpToMessage(messageId) {
  const turnIndex = turns.value.findIndex(turn => turn.messages.some(message => message.id === messageId))
  if (turnIndex < 0) return
  beginJump()
  setFollowing(false)
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  virtualizer.value.scrollToIndex(turnIndex, {
    align: 'start',
    behavior: reduce ? 'auto' : 'smooth',
  })
}
defineExpose({ jumpToMessage, jumpToBottom })

onMounted(() => {
  bindScrollRoot(props.scrollRoot)
})
watch(() => props.scrollRoot, root => bindScrollRoot(root), { flush: 'post' })
onBeforeUnmount(() => {
  unbindScrollRoot()
  clearTimeout(jumpTimer)
  clearTimeout(saveTimer)
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
  scrollParent = null
  scrollElement.value = null
}

function bindScrollRoot(root) {
  // 会话切换时 Transition 可能先挂载新时间线、后交回滚动容器。
  // 这里必须监听 scrollRoot，不能只在 onMounted 读一次，否则虚拟器拿到 null，
  // scrollRect 永远是 0，虚拟范围为空。
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
    if (restoreTop == null) virtualizer.value.scrollToEnd({ behavior: 'auto' })
    else virtualizer.value.scrollToOffset(restoreTop, { behavior: 'auto' })
    requestAnimationFrame(() => {
      if (!scrollParent) return
      // 恢复到顶部时不会产生 scroll 事件，这里主动补一页更早历史。
      if (scrollParent.scrollTop < 160) void loadEarlier()
      following.value = virtualizer.value.isAtEnd(8)
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
    class="conversation-flow conversation-flow--virtual"
    role="log"
    aria-label="对话内容"
    :style="{ height: `${totalSize}px` }"
  >
    <div
      v-for="row in rows"
      :key="row.item.key"
      :data-index="row.item.index"
      :ref="measureElement"
      class="conversation-flow__row"
      :style="{ transform: `translateY(${row.item.start}px)` }"
    >
      <article
        :data-turn-id="row.turn.id"
        class="message"
        :class="[`message--${row.turn.role}`, { 'message--compact': row.turn.messages[0].compact }]"
        :aria-label="row.turn.messages[0].compact ? '上下文压缩' : row.turn.role === 'user' ? '你的消息' : 'Agent 的回复'"
      >
        <CompactionNotice v-if="row.turn.messages[0].compact" :content="row.turn.messages[0].content" />
        <template v-else-if="row.turn.role === 'user'">
          <MessageActions
            :items="userMenuItems(row.turn.messages[0])"
            :target-id="row.turn.messages[0].id"
            label="消息操作"
            :running="session.status === 'running'"
            :rollback-target="rollbackTarget"
            :rollback-preview="rollbackPreview"
            @request-open="event => requestRollback(row.turn.messages[0])"
            @close="clearRollback"
            @action="onUserMenu(row.turn.messages[0], $event)"
            @rollback-confirm="confirmRollback"
          >
            <div class="rikka-message rikka-message--user">
              <div class="rikka-bubble rikka-bubble--user" :data-message-id="row.turn.messages[0].id">
                <Markdown :content="row.turn.messages[0].displayContent ?? row.turn.messages[0].content" />
                <div v-if="row.turn.messages[0].images?.length" class="user-images">
                  <img v-for="(image, index) in row.turn.messages[0].images" :key="index" :src="image" alt="用户发送的图片" class="user-images__thumb" />
                </div>
                <div v-if="row.turn.messages[0].attachments?.length" class="user-attachments">
                  <span v-for="(file, index) in row.turn.messages[0].attachments" :key="file.id || `${index}-${file.name}`" class="user-attachment" :title="file.name">
                    <Icon name="document" :size="14" />
                    <span class="user-attachment__name">{{ file.name }}</span>
                  </span>
                </div>
              </div>
            </div>
          </MessageActions>
        </template>
        <template v-else>
          <AssistantTurn
            :messages="row.turn.messages"
            :session-id="session.id"
            :running="session.status === 'running'"
            :active="session.status === 'running' && row.turn.id === turns.at(-1)?.id"
            :rollback-target="rollbackTarget"
            :rollback-preview="rollbackPreview"
            @rollback="requestRollback"
            @fork="forkFrom"
            @rollback-confirm="confirmRollback"
          />
        </template>
      </article>
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
