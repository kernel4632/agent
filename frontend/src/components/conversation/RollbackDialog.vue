<!--
  回退确认：新手引导式的聚光确认。
  半透明的暗层盖住整页并模糊，只在目标消息的位置留一个亮框——
  助手回复框住它自己和附带的工具步骤，用户消息框住那一条气泡；
  决策卡片贴在亮框旁边，用户始终看得到要回退的是哪一段。
  目标元素找不到（步骤被折叠等）时退回居中卡片，功能不受影响。
  调用示例：<RollbackDialog ref="rollbackDialog" :target="target" :preview="preview" @confirm="confirm" />
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Checkbox from '../../ui/Checkbox.vue'
import Button from '../../ui/Button.vue'

const props = defineProps({
  target: { type: Object, default: null },
  preview: { type: Object, default: null },
})
const emit = defineEmits(['confirm'])

const open = ref(false)
const restoreFiles = ref(true)
const frame = ref(null)                 // 亮框的视口坐标；找不到目标元素时为 null，卡片退回居中
const cardHeight = ref(0)
const card = ref(null)
let returnFocus = null

const question = computed(() => props.target?.role === 'assistant' ? '回到这条回复之前？' : '回到这条消息之前？')
const summary = computed(() => {
  if (!props.preview) return '此消息及之后的内容将从对话中回退。'
  const calls = props.preview.toolCalls?.length || 0
  const base = `从这条消息开始的 ${props.preview.messages} 条对话会被去掉`
  return calls ? `${base}，随它一起回退的还有 ${calls} 次工具调用，你可以在发送新消息前撤销这次回退。` : `${base}，你可以在发送新消息前撤销这次回退。`
})

// 量出目标消息块的范围：同一条助手消息的每个步骤（思考/正文/工具/请求行）
// 共享 data-message-id，取它们的并集再留一点呼吸空间，就是“这条回复+附带工具”的框。
function measure() {
  if (!props.target?.id) { frame.value = null; return }
  const nodes = [...document.querySelectorAll(`[data-message-id="${props.target.id}"]`)]
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

// 四块暗层拼出“框外全是模糊”的效果；中间留出的洞就是亮框的位置。
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

async function show() {
  restoreFiles.value = true
  returnFocus = document.activeElement
  open.value = true
  await nextTick()
  measure()
  await place()
  card.value?.querySelector('button')?.focus()
}

function close() {
  open.value = false
  returnFocus?.focus?.()
  returnFocus = null
}

function cancel() { close() }
function confirm() { emit('confirm', restoreFiles.value) }

// 焦点圈定在决策卡片里：Tab 到头回到第一颗，Shift+Tab 反向；Esc 等于取消。
function trapTab(event) {
  if (event.key === 'Escape') { event.preventDefault(); cancel(); return }
  if (event.key !== 'Tab' || !card.value) return
  const controls = [...card.value.querySelectorAll('button, input')]
    .filter(element => !element.disabled && element.getClientRects().length)
  if (!controls.length) return
  const first = controls[0]
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || !card.value.contains(document.activeElement))) { event.preventDefault(); first.focus() }
}

watch(() => props.preview, place)
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

defineExpose({ show, close })
</script>

<template>
  <Teleport to="body">
    <Transition name="rollback-spot">
      <div v-if="open" class="rollback-spotlight" role="dialog" :aria-label="question" @keydown="trapTab">
        <div v-for="(shade, index) in shades" :key="index" class="rollback-spotlight__shade" :style="shade" @click="cancel"></div>
        <div class="rollback-spotlight__frame" :style="frameStyle" aria-hidden="true"></div>
        <section ref="card" class="rollback-spotlight__card" :class="{ 'is-centered': !cardStyle }" :style="cardStyle || undefined">
          <h2>{{ question }}</h2>
          <p class="rollback-spotlight__summary">{{ summary }}</p>
          <div v-if="preview?.files?.length" class="rollback-files">
            <span>这一段的改动（{{ preview.files.length }} 个文件）</span>
            <ul><li v-for="file in preview.files" :key="file.path">{{ file.path }}</li></ul>
          </div>
          <Checkbox v-model="restoreFiles" label="同时把文件改回原样" />
          <p class="rollback-hint">{{ restoreFiles ? '文件和对话一起退回这一步之前。' : '只退对话，工作区里的文件保持现在的样子。' }}</p>
          <footer class="rollback-spotlight__actions">
            <Button @click="cancel">取消</Button>
            <Button variant="primary" @click="confirm">确认回退</Button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/RollbackDialog.scss"></style>
