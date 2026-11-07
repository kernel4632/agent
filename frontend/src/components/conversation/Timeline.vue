<!--
  会话时间线：按顺序显示消息、思考过程、工具调用与审批，以及回退和分支操作。
  只被会话页使用；会话从 store 读，滚动容器必须由调用方传入。
  用户消息和助手回复按轮排布；本组件拥有滚动、分批加载和消息操作接线。
  按钮和图标按钮走 ui/；右键直接进聚光引导（MessageActions 内置），回退确认也在同一张卡片里。
  调用示例：
  <Timeline :key="session.id" :scroll-root="conversationScroll" />
-->
<script setup>
import { History } from "../../features/session.js"
import { Navigation } from '../../commands/navigation.js'

import { Notice } from "../../utils/notice.js"
import { copyText } from '../../utils/clipboard.js'
import { readScroll, saveScroll } from '../../utils/session-view.js'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { store } from '../../store.js'
import { groupMessageTurns } from "../../features/session.js"
import { isSavedMessage } from "../../features/session.js"
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import MessageActions from './MessageActions.vue'
import CompactionNotice from '../feedback/CompactionNotice.vue'

import AssistantTurn from './AssistantTurn.vue'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'

const props = defineProps({
    // 滚动容器由页面显式传入，不在组件里靠 class 查找祖先。
    scrollRoot: { type: Object, default: null },
})
const session = computed(() => store.sessions[store.ui.activeSessionID])
const messages = computed(() => session.value?.messages || [])
// 一条用户消息和它后面自动接续的所有助手消息算一轮，头像和名字每轮只显示一次。
const turns = computed(() => groupMessageTurns(messages.value))
// 时间线始终保留完整高度：历史轮次不在滚动过程中加载/卸载，
// 否则滚动条长度和定位跳转都会在中途变化。
// 单轮内部的处理过程仍是折叠内容，未展开时不会挂载大段工具输出。
// 时间线在挂载期间固定属于一个会话；切会话时旧组件卸载，保存位置不能写到新会话上。
const timelineSessionID = session.value?.id || ''
const savedView = readScroll(timelineSessionID)
const following = ref(savedView ? savedView.pinned : true)
const latestPosition = ref({ right: '24px', bottom: '96px' })
const rollbackTarget = ref(null)
const rollbackPreview = ref(null)
const flow = ref(null)
let scrollParent
let observer
let viewportObserver
let stickFrame = 0
let jumpTimer = 0
let jumping = false
let lastTop = 0
let saveTimer = 0
let pointerActive = false
let touchStartY = null
let touchStartTop = 0
let resumeFollow = false

const maxScrollTop = () => scrollParent ? Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight) : 0
const atBottom = (threshold = 4) => Boolean(scrollParent) && maxScrollTop() - scrollParent.scrollTop <= threshold

// “回到最新”用 fixed 覆盖在聊天区右下角，不能参与 flow 布局；
// 否则按钮出现/消失会改变 scrollHeight，滚动条会突然变长或变短。
function syncLatestPosition() {
  if (!scrollParent || !flow.value) return
  const scrollRect = scrollParent.getBoundingClientRect()
  const flowRect = flow.value.getBoundingClientRect()
  latestPosition.value = {
    right: `${Math.max(12, window.innerWidth - flowRect.right + 8)}px`,
    bottom: `${Math.max(12, window.innerHeight - scrollRect.bottom + 12)}px`,
  }
}
watch(following, value => {
  if (!value) nextTick(syncLatestPosition)
})

// 滚动事件很密，先记在内存里，停手后再落一次 localStorage；刷新前再强制写一次。
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

// 是否跟随末尾只由读者输入改变；程序滚动、resize、浏览器 clamp 都不参与判断。
function setFollowing(value) {
  if (!value) resumeFollow = false
  scrollParent?.classList.toggle('is-following', value)
  if (following.value === value) return
  following.value = value
  if (value) {
    resumeFollow = false
    queueStick()
  }
}
function stopFollowing() {
  resumeFollow = false
  if (stickFrame) {
    cancelAnimationFrame(stickFrame)
    stickFrame = 0
  }
  setFollowing(false)
}
// 定位跳转期间不接受滚轮/滚动条的程序滚动判定，避免平滑动画被“回到底部”打断。
function beginJump() {
  jumping = true
  clearTimeout(jumpTimer)
  jumpTimer = window.setTimeout(() => {
    jumping = false
    lastTop = scrollParent?.scrollTop || 0
    rememberScroll()
    if (following.value) queueStick()
  }, 1500)
}
function endJump() {
  jumping = false
  clearTimeout(jumpTimer)
  jumpTimer = 0
}

// 内容变高/变矮、视口高度变化都只触发这一条路径；没有 scroll 事件反馈。
function queueStick() {
  // 平滑跳转期间不要用手动吸底抢占动画；跳转结束再补一次底。
  if (jumping || !following.value || !scrollParent || stickFrame) return
  stickFrame = requestAnimationFrame(() => {
    stickFrame = 0
    if (!following.value || !scrollParent) return
    const max = maxScrollTop()
    if (max <= scrollParent.scrollTop + 1) return
    scrollParent.scrollTop = max
  })
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
  const top = scrollParent.scrollTop
  if (jumping) {
    lastTop = top
    rememberScroll()
    return
  }
  // 只有按住指针/拖动滚动条时的位置变化才可能是读者移动；程序写入不参与。
  if (pointerActive) {
    if (top < lastTop - 1) stopFollowing()
    else if (top > lastTop + 1 && atBottom()) setFollowing(true)
  } else if (resumeFollow && !following.value && atBottom()) {
    // 用户明确向下滚过，但滚到底时 wheel 事件已经结束；用这个标记补上最后一步。
    setFollowing(true)
  }
  lastTop = top
  syncLatestPosition()
  rememberScroll()
}

function onWheel(event) {
  if (!scrollParent) return
  if (scrollParent.scrollHeight <= scrollParent.clientHeight) return
  const nested = nestedScroller(event.target)
  if (nested) {
    // 内部滚动区还能动时先让它消费；它到顶/到底后再轮到聊天容器。
    if (event.deltaY < 0 && nested.scrollTop > 0) return
    if (event.deltaY > 0 && nested.scrollTop + nested.clientHeight < nested.scrollHeight - 1) return
  }
  if (event.deltaY < 0) {
    stopFollowing()
  } else if (event.deltaY > 0) {
    resumeFollow = true
    if (atBottom()) setFollowing(true)
  }
}

function onPointerDown(event) {
  pointerActive = !nestedScroller(event.target)
  lastTop = scrollParent?.scrollTop || 0
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
  if (distance > 8 && scrollParent.scrollTop <= touchStartTop + 1) stopFollowing()
  else if (distance < -8) {
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
    stopFollowing()
    return
  }
  if (event.key === 'End') {
    setFollowing(true)
    if (scrollParent) scrollParent.scrollTop = maxScrollTop()
    return
  }
  // PageDown / ArrowDown 只有在浏览器真的滚到底后才恢复跟随。
  resumeFollow = true
  requestAnimationFrame(() => {
    if (atBottom()) setFollowing(true)
  })
}

// 展开旧工具/思考卡片属于浏览历史，不应再被下一段流式输出拽回底部。
function onClick(event) {
  const head = event.target instanceof Element ? event.target.closest('.cot-step__head') : null
  if (head && scrollParent?.contains(head)) stopFollowing()
}

function jumpToBottom() {
  if (!scrollParent) return
  beginJump()
  setFollowing(true)
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  scrollParent.scrollTo({ top: maxScrollTop(), behavior: reduce ? 'auto' : 'smooth' })
  lastTop = scrollParent.scrollTop
  rememberScroll()
}

// 右侧定位条跳转：目标可能还没有挂到 DOM，先把包含它的那一轮展开出来。
async function jumpToMessage(messageId) {
  if (!scrollParent) return
  const turnIndex = turns.value.findIndex(turn => turn.messages.some(message => message.id === messageId))
  if (turnIndex < 0) return
  const turn = turns.value[turnIndex]
  // 点当前正在看的这一轮（比如底部最新用户消息）时不要往上跳；
  // 只有目标轮次完全在视口外才滚动。
  const turnElement = scrollParent.querySelector(`[data-turn-id="${CSS.escape(String(turn.id))}"]`)
  const viewport = scrollParent.getBoundingClientRect()
  if (turnElement) {
    const rect = turnElement.getBoundingClientRect()
    if (rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1) return
  }
  // 先把跳转状态立起来；定位动画期间不做任何窗口/高度调整。
  beginJump()
  await nextTick()
  const target = scrollParent.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`)
    || scrollParent.querySelector(`[data-turn-id="${CSS.escape(String(messageId))}"]`)
  if (!target) {
    endJump()
    return
  }
  stopFollowing()
  const top = target.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top + scrollParent.scrollTop - 12
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  scrollParent.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
  lastTop = scrollParent.scrollTop
  rememberScroll()
  // 平滑滚动结束后再记一次最终位置；中间的 scroll 事件不反向触发跟随。
  setTimeout(() => {
    if (jumping) {
      lastTop = scrollParent.scrollTop
      rememberScroll()
    }
  }, 900)
}
defineExpose({ jumpToMessage, jumpToBottom })
watch(() => turns.value.length, () => {
  if (following.value) queueStick()
})
onMounted(() => {
  scrollParent = props.scrollRoot
  lastTop = scrollParent?.scrollTop || 0
  scrollParent?.classList.toggle('is-following', following.value)
  scrollParent?.addEventListener('scroll', onScroll, { passive: true })
  scrollParent?.addEventListener('wheel', onWheel, { passive: true })
  scrollParent?.addEventListener('pointerdown', onPointerDown, { passive: true })
  scrollParent?.addEventListener('touchstart', onTouchStart, { passive: true })
  scrollParent?.addEventListener('touchmove', onTouchMove, { passive: true })
  scrollParent?.addEventListener('touchend', onTouchEnd, { passive: true })
  scrollParent?.addEventListener('touchcancel', onTouchEnd, { passive: true })
  scrollParent?.addEventListener('click', onClick)
  window.addEventListener('pointerup', onPointerUp, { passive: true })
  window.addEventListener('pointercancel', onPointerUp, { passive: true })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pagehide', flushScroll) // 刷新/关页前把最后位置落盘
  // 内容高度变化只负责“跟随到底”，绝不反向改变 following。
  observer = new ResizeObserver(() => {
    if (following.value) queueStick()
  })
  if (flow.value) observer.observe(flow.value)
  // 输入框/窗口变高变矮会改变视口；跟随中保持贴底，浏览中保持读者位置。
  viewportObserver = new ResizeObserver(() => {
    if (following.value) queueStick()
    syncLatestPosition()
  })
  if (scrollParent) viewportObserver.observe(scrollParent)
  syncLatestPosition()
  // 刷新后回到原来的位置；没有记录或当时停在底部，就继续跟最新内容。
  const restoreTop = savedView && !savedView.pinned && Number.isFinite(savedView.top) ? savedView.top : null
  if (restoreTop == null) {
    queueStick()
    return
  }
  const applyRestore = () => {
    if (!scrollParent) return
    scrollParent.scrollTop = restoreTop
    lastTop = scrollParent.scrollTop
  }
  nextTick(() => requestAnimationFrame(() => {
    applyRestore()
    requestAnimationFrame(() => {
      applyRestore() // 字体/图片首帧后高度可能还在变，再对齐一次
      if (!following.value && atBottom(24)) setFollowing(true)
    })
  }))
})
onBeforeUnmount(() => {
  flushScroll()
  scrollParent?.removeEventListener('scroll', onScroll)
  scrollParent?.removeEventListener('wheel', onWheel)
  scrollParent?.removeEventListener('pointerdown', onPointerDown)
  scrollParent?.removeEventListener('touchstart', onTouchStart)
  scrollParent?.removeEventListener('touchmove', onTouchMove)
  scrollParent?.removeEventListener('touchend', onTouchEnd)
  scrollParent?.removeEventListener('touchcancel', onTouchEnd)
  scrollParent?.removeEventListener('click', onClick)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pagehide', flushScroll)
  observer?.disconnect()
  viewportObserver?.disconnect()
  if (stickFrame) cancelAnimationFrame(stickFrame)
  clearTimeout(jumpTimer)
  clearTimeout(saveTimer)
})
// 只回退后端存过的消息；pending 和本地错误消息没有可用的 messageId。
const canRollback = message => isSavedMessage(message)

// 右键打开聚光时就取代价预览：用户点“回退”切换到确认态时代价已经在了。
// 任务运行中也能预览：确认卡片会写“会先停止当前任务”，真正回退前由 Chat.stop 停掉。
async function requestRollback(message) {
  if (!canRollback(message)) return
  rollbackTarget.value = message
  rollbackPreview.value = await History.previewRollback(session.value.id, message.id)
}
// 聚光关闭后清掉确认状态；回退成功由 History.rollbackMessage 刷新会话并弹提示。
function clearRollback() {
  rollbackTarget.value = null
  rollbackPreview.value = null
}
async function confirmRollback(restoreFiles) {
  const sessionID = session.value.id
  // 任务还在跑时先停止：回退请求会被 409 拒绝，等待落盘后再退，历史才是完整快照。
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

// 继续入口已经合并到输入框的发送按钮。

// 复制只在本区域反馈，剪贴板工具不依赖页面。
async function copyMessage(text) { Notice.show(await copyText(text) ? '已复制' : '复制失败'); }
</script>

<template>
  <div ref="flow" class="conversation-flow" role="log" aria-label="对话内容">
    <article v-for="turn in turns" :key="turn.id" :data-turn-id="turn.id" class="message" :class="[`message--${turn.role}`, { 'message--compact': turn.messages[0].compact }]" :aria-label="turn.messages[0].compact ? '上下文压缩' : turn.role === 'user' ? '你的消息' : 'Agent 的回复'">
      <CompactionNotice v-if="turn.messages[0].compact" :content="turn.messages[0].content" />
      <template v-else-if="turn.role === 'user'">
        <MessageActions
          :items="userMenuItems(turn.messages[0])"
          :target-id="turn.messages[0].id"
          label="消息操作"
          :running="session.status === 'running'"
          :rollback-target="rollbackTarget"
          :rollback-preview="rollbackPreview"
          @request-open="event => requestRollback(turn.messages[0])"
          @close="clearRollback"
          @action="onUserMenu(turn.messages[0], $event)"
          @rollback-confirm="confirmRollback"
        >
          <div class="rikka-message rikka-message--user">
            <div class="rikka-bubble rikka-bubble--user" :data-message-id="turn.messages[0].id">
              <Markdown :content="turn.messages[0].displayContent ?? turn.messages[0].content" />
              <div v-if="turn.messages[0].images?.length" class="user-images">
                <img v-for="(image, index) in turn.messages[0].images" :key="index" :src="image" alt="用户发送的图片" class="user-images__thumb" />
              </div>
              <div v-if="turn.messages[0].attachments?.length" class="user-attachments">
                <span v-for="(file, index) in turn.messages[0].attachments" :key="file.id || `${index}-${file.name}`" class="user-attachment" :title="file.name">
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
          :messages="turn.messages"
          :session-id="session.id"
          :running="session.status === 'running'"
          :rollback-target="rollbackTarget"
          :rollback-preview="rollbackPreview"
          @rollback="requestRollback"
          @fork="forkFrom"
          @rollback-confirm="confirmRollback"
        />
      </template>
    </article>
    <div v-if="!following" class="conversation-latest-layer" :style="latestPosition">
      <button type="button" class="conversation-latest" @click="jumpToBottom">
        <Icon name="down" :size="14" />
        回到最新
      </button>
    </div>
  </div>
</template>

<style lang="scss" src="../../styles/components/conversation/Timeline.scss"></style>
