<!--
消息操作层：右键、长按或键盘菜单键直接进入聚光引导——
暗层盖住整页并模糊，只在目标消息的位置留一个亮框，决策卡片贴在亮框旁边。
卡片只给可操作的按钮（复制/回退/分支），消息内容留在页面上不动；点回退后原位切换成回退确认，不再有居中大菜单。
目标消息由父组件解析：这里把触发事件原样抛上去，父组件决定框哪一条（含落点无效时退回默认目标）。
调用示例：
<MessageActions :items="items" :target-id="targetId"
  :rollback-target="target" :rollback-preview="preview" label="助手消息操作"
  @request-open="resolveTarget" @close="clearRollback" @action="onMenu" @rollback-confirm="confirmRollback">
  <slot />
</MessageActions>
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Checkbox from '../../ui/Checkbox.vue'
import Button from '../../ui/Button.vue'
import Icon from '../../ui/Icon.vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  targetId: { type: String, default: null },                 // 要框住的消息 id，父组件解析好再传进来
  label: { type: String, default: '消息操作' },
  rollbackTarget: { type: Object, default: null },           // 父组件收到回退动作后设置；角色决定确认标题
  rollbackPreview: { type: Object, default: null },          // 后端代价预览；清空（成功/取消）时关闭确认态
})
const emit = defineEmits(['request-open', 'close', 'action', 'rollback-confirm'])

const open = ref(false)
const mode = ref('menu')                // menu=选操作；confirm=回退确认
const restoreFiles = ref(true)
const frame = ref(null)                 // 亮框的视口坐标；找不到目标元素时为 null，卡片退回居中
const cardHeight = ref(0)
const card = ref(null)
let returnFocus = null
let pressTimer = null
let pressStart = null
let pressed = false
let pressEvent = null

const question = computed(() => props.rollbackTarget?.role === 'assistant' ? '回到这条回复之前？' : '回到这条消息之前？')
const confirmSummary = computed(() => {
  if (!props.rollbackPreview) return '此消息及之后的内容将从对话中回退。'
  const calls = props.rollbackPreview.toolCalls?.length || 0
  const base = `从这条消息开始的 ${props.rollbackPreview.messages} 条对话会被去掉`
  return calls ? `${base}，随它一起回退的还有 ${calls} 次工具调用，你可以在发送新消息前撤销这次回退。` : `${base}，你可以在发送新消息前撤销这次回退。`
})
const dialogLabel = computed(() => mode.value === 'confirm' ? question.value : props.label)

// --- 量出目标消息块的范围 ---
// 同一条助手消息的每个步骤（思考/正文/工具/请求行）共享 data-message-id，
// 取它们的并集再留一点呼吸空间，就是“这条回复+附带工具”的框。
function measure() {
  if (!props.targetId) { frame.value = null; return }
  const nodes = [...document.querySelectorAll(`[data-message-id="${props.targetId}"]`)]
    .filter(element => element.getClientRects().length)
  if (!nodes.length) { frame.value = null; return }
  const boxes = nodes.map(element => element.getBoundingClientRect())
  const pad = 8
  const left = Math.max(8, Math.min(...boxes.map(box => box.left)) - pad)
  const top = Math.max(8, Math.min(...boxes.map(box => box.top)) - pad)
  const right = Math.min(window.innerWidth - 8, Math.max(...boxes.map(box => box.right)) + pad)
  const bottom = Math.min(window.innerHeight - 8, Math.max(...boxes.map(box => box.bottom)) + pad)
  frame.value = { x: left, y: top, width: right - left, height: bottom - top }
}

// 四块暗层拼出“框外全是模糊”；中间留出的洞就是亮框的位置。
const shades = computed(() => {
  const f = frame.value
  if (!f) return [{ left: '0', top: '0', width: '100%', height: '100%' }]
  const bottom = f.y + f.height
  const right = f.x + f.width
  return [
    { left: '0', top: '0', width: '100%', height: `${f.y}px` },
    { left: '0', top: `${bottom}px`, width: '100%', height: `calc(100% - ${bottom}px)` },
    { left: '0', top: `${f.y}px`, width: `${f.x}px`, height: `${f.height}px` },
    { left: `${right}px`, top: `${f.y}px`, width: `calc(100% - ${right}px)`, height: `${f.height}px` },
  ]
})
const frameStyle = computed(() => {
  const f = frame.value
  return f ? { left: `${f.x}px`, top: `${f.y}px`, width: `${f.width}px`, height: `${f.height}px` } : { display: 'none' }
})
// 决策卡片优先贴在亮框下方，放不下就换到上方；横向贴着框中心但不出视口。
const cardStyle = computed(() => {
  const f = frame.value
  if (!f || !cardHeight.value) return null
  const width = Math.min(380, window.innerWidth - 24)
  const left = Math.max(12, Math.min(f.x + f.width / 2 - width / 2, window.innerWidth - width - 12))
  const gap = 14
  let top = f.y + f.height + gap
  if (top + cardHeight.value > window.innerHeight - 12) top = f.y - gap - cardHeight.value
  top = Math.max(12, Math.min(top, window.innerHeight - cardHeight.value - 12))
  return { left: `${left}px`, top: `${top}px`, width: `${width}px` }
})

async function place() {
  await nextTick()
  cardHeight.value = card.value?.offsetHeight || 0
}

function onResize() {
  if (!open.value) return
  measure()
  place()
}

// --- 打开与关闭 ---
watch(open, async value => {
  if (value) {
    mode.value = 'menu'
    restoreFiles.value = true
    returnFocus = document.activeElement
    await nextTick()
    measure()
    await place()
    card.value?.querySelector('button')?.focus()
  } else {
    returnFocus?.focus?.()
    returnFocus = null
  }
})
// 目标在打开期间变化（右键换了消息）就重新量框。
watch(() => props.targetId, () => { if (open.value) { measure(); place() } })
// 点回退后卡片切到确认态：重排一次并让焦点落在卡片按钮上。
watch(mode, async value => {
  if (!open.value || value !== 'confirm') return
  await nextTick()
  await place()
  card.value?.querySelector('button')?.focus()
})
// 代价预览到达时重排卡片；取预览失败（一直是 null）不关卡片，退回通用文案。
watch(() => props.rollbackPreview, () => { if (open.value) place() })
// 回退成功后父组件清掉目标，聚光跟着收起。
watch(() => props.rollbackTarget, target => { if (open.value && mode.value === 'confirm' && !target) close() })

// --- 触发：事件原样交给父组件解析目标，这里只负责开 ---
function requestOpen(event) {
  if (!props.items.length) return
  emit('request-open', event)
  open.value = true
}
function onContextMenu(event) { requestOpen(event) }
function onKeydown(event) {
  // Shift+F10 和菜单键是键盘用户打开消息操作的通用方式；没有落点，沿用上一次目标。
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault()
    requestOpen(null)
  }
}
// 长按（触屏）：按住 480ms 打开；移动超过 8px 当作滚动或选字，取消。
function onPointerDown(event) {
  if (event.pointerType === 'mouse') return                    // 鼠标用右键 contextmenu，不走长按
  pressed = true
  pressEvent = event
  pressStart = { x: event.clientX, y: event.clientY }
  pressTimer = window.setTimeout(() => {
    if (pressed) requestOpen(pressEvent)
    cancelPress()
  }, 480)
}
function onPointerMove(event) {
  if (!pressed || !pressStart) return
  if (Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > 8) cancelPress()
}
function cancelPress() {
  if (pressTimer) window.clearTimeout(pressTimer)
  pressTimer = null
  pressed = false
  pressStart = null
  pressEvent = null
}

function close() {
  if (!open.value) return
  open.value = false
  emit('close')
}

function choose(value) {
  if (value === 'rollback') {
    mode.value = 'confirm'                                     // 聚光不关，卡片原位切成回退确认
    emit('action', value, props.targetId)
    return
  }
  emit('action', value, props.targetId)
  close()
}
function confirmRollback() { emit('rollback-confirm', restoreFiles.value) }

// 焦点圈定在决策卡片里：Tab 到头回到第一颗，Shift+Tab 反向；Esc 等于取消。
function trapTab(event) {
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key !== 'Tab' || !card.value) return
  const controls = [...card.value.querySelectorAll('button, input')]
    .filter(element => !element.disabled && element.getClientRects().length)
  if (!controls.length) return
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || !card.value.contains(document.activeElement))) { event.preventDefault(); first.focus() }
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  cancelPress()
})
</script>

<template>
  <div
    class="message-action-target"
    tabindex="0"
    @contextmenu.prevent="onContextMenu"
    @keydown="onKeydown"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="cancelPress"
    @pointercancel="cancelPress"
  >
    <slot />
  </div>

  <Teleport to="body">
    <Transition name="rollback-spot">
      <div v-if="open" class="rollback-spotlight" role="dialog" :aria-label="dialogLabel" @keydown="trapTab">
        <div v-for="(shade, index) in shades" :key="index" class="rollback-spotlight__shade" :style="shade" @click="close"></div>
        <div class="rollback-spotlight__frame" :style="frameStyle" aria-hidden="true"></div>
        <section ref="card" class="rollback-spotlight__card" :class="{ 'is-centered': !cardStyle }" :style="cardStyle || undefined">
          <template v-if="mode === 'confirm'">
            <h2>{{ question }}</h2>
            <p class="rollback-spotlight__summary">{{ confirmSummary }}</p>
            <div v-if="rollbackPreview?.files?.length" class="rollback-files">
              <span>这一段的改动（{{ rollbackPreview.files.length }} 个文件）</span>
              <ul><li v-for="file in rollbackPreview.files" :key="file.path">{{ file.path }}</li></ul>
            </div>
            <Checkbox v-model="restoreFiles" label="同时把文件改回原样" />
            <p class="rollback-hint">{{ restoreFiles ? '文件和对话一起退回这一步之前。' : '只退对话，工作区里的文件保持现在的样子。' }}</p>
            <footer class="rollback-spotlight__actions">
              <Button @click="close">取消</Button>
              <Button variant="primary" @click="confirmRollback">确认回退</Button>
            </footer>
          </template>
          <template v-else>
            <div class="message-actions__items">
              <Button
                v-for="item in items"
                :key="item.value"
                variant="ghost"
                class="message-actions__item"
                :disabled="item.disabled"
                @click="choose(item.value)"
              >
                <Icon :name="item.icon || 'spark'" :size="18" /><span>{{ item.label }}</span>
              </Button>
            </div>
          </template>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/MessageActions.scss"></style>
