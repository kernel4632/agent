<!-- 代码块：高亮、行号、复制；mermaid 块动态渲染成图，语法错误回退源码。
     图表配色读 tokens.scss 的 Markdown 变量（--md-*），与正文渲染同色；点击图表进全屏，可缩放平移。
     示例：<CodeBlock :code="source" language="js" /> -->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import hljs from 'highlight.js'
import Button from './Button.vue'
import Dialog from './Dialog.vue'
import Icon from './Icon.vue'
import { Notice } from '../utils/notice.js'
const props = defineProps({ code: { type: String, default: '' }, language: { type: String, default: 'text' }, lineNumbers: Boolean })
const status = ref('复制')
let timer
const highlighted = computed(() => hljs.highlight(props.code, { language: hljs.getLanguage(props.language) ? props.language : 'plaintext', ignoreIllegals: true }).value)

// --- mermaid：按需加载渲染成 SVG；语法错误回退显示源码 ---
const isMermaid = computed(() => props.language === 'mermaid')
const diagram = ref('')
const diagramError = ref('')
let mermaidLib = null

// 渲染结果缓存：按图表源码缓存，同一张图在页面里出现两次（或折叠后又展开）不重画。
// 值是 Promise，并发请求同一张图时也只渲染一次。
// 主题变了要整体作废：SVG 颜色是烧进去的具体色值。
const diagramCache = new Map()
const cacheKey = code => `${document.documentElement.dataset.theme || ''}\u0000${code}`

// mermaid 的渲染器是全局单例，并发 render 会互相污染甚至卡死；所有图表排队逐个画。
let renderQueue = Promise.resolve()
const enqueue = task => {
  const run = renderQueue.then(task, task)
  renderQueue = run.catch(() => undefined)
  return run
}

// --- 图表主题：与 Markdown 渲染同一套颜色 ---
// 颜色统一来自 tokens.scss 的 --md-* / --la-*（getComputedStyle 读出的是已求值的具体色值）；
// mermaid 的 SVG 不认 CSS 变量，渲染时把色值烧进图里，所以主题切换后要重新读取重画。
// 变量缺失时（如纯测试环境）退回浅色默认值。
const FALLBACK = {
  '--md-link': '#3b7dd8', '--md-link-text': '#318795', '--md-code': '#3d9a57', '--md-quote': '#b0851f',
  '--md-heading': '#d68c27', '--md-enum': '#318795', '--md-number': '#d68c27', '--md-type': '#b0851f', '--md-rule': '#8a8a8a',
  '--la-text': '#1b1b21', '--la-secondary': '#45464f', '--la-bg': '#faf8ff', '--la-on-accent': '#fff',
  '--la-danger': '#ba1a1a', '--la-success': '#286b3b',
  '--la-font-reading': 'Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
}
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || FALLBACK[name]

// mermaid 不认 color-mix()，这里手动做同语义的 sRGB 混合：weight 是掺入 tint 的百分比。
function mix(base, tint, weight) {
  const parse = color => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim())?.[1]
    if (!hex) return null
    const digits = hex.length === 3 ? [...hex].map(digit => digit + digit).join('') : hex
    return [0, 2, 4].map(offset => parseInt(digits.slice(offset, offset + 2), 16))
  }
  const from = parse(base)
  const to = parse(tint)
  if (!from || !to) return base
  const ratio = weight / 100
  return `#${from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio).toString(16).padStart(2, '0')).join('')}`
}

function diagramTheme() {
  const text = css('--la-text')
  const secondary = css('--la-secondary')
  const line = css('--md-rule')
  const bg = css('--la-bg')
  const accent = css('--md-link')       // 链接色 = 图表主色
  const note = css('--md-quote')        // 引用色 = 注释/说明类元素
  const info = css('--md-link-text')    // 链接悬停色 = 次要分组
  const heading = css('--md-heading')
  const soft = color => mix(bg, color, 12)  // 节点底：正文底色掺 12% 语义色
  const edge = color => mix(color, bg, 50)  // 描边：语义色向底色收一半，不压过文字
  const cycle = [heading, accent, info, css('--md-code'), note, css('--md-enum'), css('--md-number'), css('--md-type')]
  return {
    darkMode: false,
    background: 'transparent',
    fontFamily: css('--la-font-reading'),
    fontSize: '14px',
    // 通用：节点、文字、连线、箭头
    primaryColor: soft(accent), primaryTextColor: text, primaryBorderColor: edge(accent),
    secondaryColor: soft(note), secondaryTextColor: note, secondaryBorderColor: edge(note),
    tertiaryColor: soft(info), tertiaryTextColor: text, tertiaryBorderColor: edge(info),
    lineColor: line, arrowheadColor: line, transitionColor: line, transitionLabelColor: secondary,
    textColor: text, mainBkg: soft(accent), nodeBorder: edge(accent), classText: text, specialStateColor: text,
    titleColor: heading,
    clusterBkg: mix(bg, accent, 4), clusterBorder: mix(bg, accent, 30), clusterTitleColor: secondary,
    edgeLabelBackground: bg, labelTextColor: text, labelBoxBkgColor: soft(accent), labelBoxBorderColor: edge(accent),
    noteTextColor: note, noteBorderColor: edge(note), noteBkgColor: soft(note),
    // 时序图
    actorBkg: soft(accent), actorBorder: edge(accent), actorTextColor: text, actorLineColor: line,
    signalColor: secondary, signalTextColor: secondary, loopTextColor: note,
    activationBkgColor: soft(accent), activationBorderColor: edge(accent),
    sequenceNumberColor: css('--la-on-accent'),
    // 甘特/时间线的分区与任务
    sectionBkgColor: soft(accent), sectionBkgColor2: soft(info), altSectionBkgColor: soft(info), altBackground: soft(info),
    taskBkgColor: soft(accent), taskBorderColor: edge(accent), taskTextColor: text, taskTextDarkColor: text, taskTextOutsideColor: text,
    activeTaskBkgColor: soft(heading), activeTaskBorderColor: edge(heading),
    doneTaskBkgColor: soft(css('--la-success')), doneTaskBorderColor: edge(css('--la-success')),
    critBkgColor: soft(css('--la-danger')), critBorderColor: edge(css('--la-danger')),
    // 分支图
    gitBranchLabel0: accent, gitBranchLabel1: info, gitBranchLabel2: note, gitBranchLabel3: css('--md-enum'),
    gitBranchLabel4: css('--md-number'), gitBranchLabel5: css('--md-type'), gitBranchLabel6: heading, gitBranchLabel7: accent,
    commitLabelColor: secondary, commitLabelBackground: bg, tagLabelColor: text, tagLabelBackground: soft(accent), tagLabelBorder: edge(accent),
    // 饼图、时间线/象限的成组配色：按 Markdown 语义色循环取
    pie1: cycle[0], pie2: cycle[1], pie3: cycle[2], pie4: cycle[3], pie5: cycle[4], pie6: cycle[5], pie7: cycle[6], pie8: cycle[7],
    pieTitleTextColor: heading, pieSectionTextColor: text, pieLegendTextColor: secondary, pieStrokeColor: bg, pieOuterStrokeColor: edge(accent),
    fillType0: soft(cycle[0]), fillType1: soft(cycle[1]), fillType2: soft(cycle[2]), fillType3: soft(cycle[3]),
    fillType4: soft(cycle[4]), fillType5: soft(cycle[5]), fillType6: soft(cycle[6]), fillType7: soft(cycle[7]),
    quadrant1Fill: soft(cycle[1]), quadrant2Fill: soft(cycle[0]), quadrant3Fill: soft(cycle[3]), quadrant4Fill: soft(cycle[2]),
    quadrantPointFill: accent, quadrantPointTextFill: text, quadrantXAxisTextFill: secondary, quadrantYAxisTextFill: secondary,
    quadrantInternalBorderStrokeFill: mix(bg, accent, 30), quadrantTitleFill: heading,
  }
}

const loadMermaid = async () => {
  if (!mermaidLib) {
    mermaidLib = import('mermaid').then(module => ({
      // 每次渲染前都重新 initialize：themeVariables 要现场重读界面变量（主题切换后即新值）；
      // 重复 initialize 是官方支持的配置方式；securityLevel strict 转义图内 HTML。
      configure: () => module.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: diagramTheme() }),
      mermaid: module.default,
    }))
  }
  return mermaidLib
}

// 虚拟列表只挂载视口附近的轮次，Mermaid 组件会随行卸载/重建；
// 这里不再做第二层 IntersectionObserver 懒加载。挂载即查缓存并排队渲染，
// 否则重新滚回底部时会先出现一大块空白占位，等观察器和渲染队列才恢复。
const placeholderHeight = '120px'
let drawToken = 0

async function draw() {
  if (!isMermaid.value) { diagram.value = ''; diagramError.value = ''; return }

  const token = ++drawToken
  // 缓存命中：直接拿上次的渲染结果（或正在渲染中的那次的 Promise）。
  const key = cacheKey(props.code)
  const cached = diagramCache.get(key)
  if (cached) {
    const result = await cached
    if (token !== drawToken) return
    diagram.value = result.svg
    diagramError.value = result.error
    return
  }

  // mermaid 的临时元素按 id 挂在全局 DOM 上，两个组件实例不能撞 id，用随机 id 保证唯一。
  const id = `mermaid-${crypto.randomUUID()}`
  const task = enqueue(async () => {
    try {
      const { mermaid, configure } = await loadMermaid()
      configure()
      const { svg } = await mermaid.render(id, props.code)
      return { svg, error: '' }
    } catch (error) {
      // 渲染失败就亮出源码，模型能自己读到错误继续改；错误只取第一行，hash 对象不进界面。
      return { svg: '', error: String(error?.message || error).split('\n')[0] }
    } finally {
      // mermaid 失败时会把错误提示元素留在 body 尾部（id 为 d<renderId>），拿走它免得页面上多出一行裸错误。
      document.getElementById(`d${id}`)?.remove()
    }
  })
  diagramCache.set(key, task)
  const result = await task
  if (token !== drawToken) return
  diagram.value = result.svg
  diagramError.value = result.error
}

// 源码变化、主题变化、虚拟行重新挂载都立即重画；不再等进入视口。
watch([isMermaid, () => props.code], () => {
  diagram.value = ''
  diagramError.value = ''
  void draw()
}, { immediate: true })

// mermaid 的 SVG 颜色是渲染时烧进去的具体色值，不跟 CSS 变量走；
// 界面切主题后要按新主题重画一遍，否则暗底上留着浅色主题的深色文字。
onMounted(() => {
  window.addEventListener('agent-theme', refreshTheme)
})
onBeforeUnmount(() => { window.removeEventListener('agent-theme', refreshTheme); clearTimeout(timer); clearTimeout(flashTimer) })

// 主题变了：缓存里存的颜色已过期，清掉后按新主题重画当前这张。
function refreshTheme() {
  diagramCache.clear()
  void draw()
}

async function copy() {
  try { await navigator.clipboard.writeText(props.code); status.value = '已复制' }
  catch { status.value = '复制失败' }
  clearTimeout(timer)
  timer = setTimeout(() => { status.value = '复制' }, 2000)
}

// --- 全屏查看：teleport 层里滚轮/按钮缩放、拖拽平移，空处点击或 Esc 关闭 ---
const fullscreen = ref(false)
const stage = ref(null)
const mermaidBox = ref(null)
const MIN_SCALE = .2
const MAX_SCALE = 8
const scale = ref(1)
const pan = ref({ x: 0, y: 0 })
const clampScale = value => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
const viewStyle = computed(() => ({ transform: `translate(calc(-50% + ${pan.value.x}px), calc(-50% + ${pan.value.y}px)) scale(${scale.value})` }))

// 打开与“复位”都回到初始视图：整张图收进视口（留 8% 边），量不到尺寸就保持 1。
async function fitView() {
  scale.value = 1
  pan.value = { x: 0, y: 0 }
  await nextTick()
  const svg = stage.value?.querySelector('svg')
  const box = stage.value?.getBoundingClientRect()
  const size = svg?.getBoundingClientRect()
  if (!svg || !box?.width || !box?.height || !size?.width || !size?.height) return
  scale.value = clampScale(Math.min(1, (box.width * .92) / size.width, (box.height * .92) / size.height))
}
watch(fullscreen, open => { if (open) fitView() })

function nudge(step) { scale.value = clampScale(scale.value * (step > 0 ? 1.25 : .8)) }
function resetView() { fitView() }

// 滚轮缩放并保持光标下的内容不动；按住 Alt 反向。
function onWheel(event) {
  const next = clampScale(scale.value * Math.exp((event.altKey ? 1 : -1) * event.deltaY * .0016))
  const box = stage.value?.getBoundingClientRect()
  if (!box?.width) { scale.value = next; return }
  const pointerX = event.clientX - box.left - box.width / 2
  const pointerY = event.clientY - box.top - box.height / 2
  const ratio = next / scale.value
  pan.value = { x: pointerX - (pointerX - pan.value.x) * ratio, y: pointerY - (pointerY - pan.value.y) * ratio }
  scale.value = next
}

let drag = null
function dragStart(event) {
  if (event.button !== 0) return
  drag = { x: event.clientX - pan.value.x, y: event.clientY - pan.value.y }
  event.currentTarget.setPointerCapture(event.pointerId)
}
function dragMove(event) {
  if (drag) pan.value = { x: event.clientX - drag.x, y: event.clientY - drag.y }
}
function dragEnd(event) {
  drag = null
  event.currentTarget.releasePointerCapture?.(event.pointerId)
}
// 点击图表外的空处关闭；点在图上是拖拽平移，不触发。
function closeOnEmpty(event) { if (event.target === event.currentTarget) fullscreen.value = false }

// --- 图表导出：栅格化成 PNG 进剪贴板/存成文件；画布被拒绝时回退矢量 SVG 源 ---
const flash = ref('')
let flashTimer
// 全屏层是原生 dialog（浏览器顶层渲染），全局 Toast 会被压在下面；
// 所以全屏里的反馈就地闪现，非全屏时仍走全局 Toast。
function flashOrNotice(message) {
  if (!fullscreen.value) { Notice.show(message); return }
  flash.value = message
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flash.value = '' }, 2000)
}

function pickSvg() {
  return (fullscreen.value ? stage.value : mermaidBox.value)?.querySelector('svg') || null
}

// 带 <foreignObject> 的 SVG 画进 canvas 会污染画布，toDataURL 抛 SecurityError，PNG 导不出来。
// mermaid 的节点标签默认就是 foreignObject，且各图表类型的开关并不一致（关了就丢标签样式）；
// 所以导出前在克隆出来的节点上把 foreignObject 降级成原生 <text>：文本居中摆放，
// 字体颜色从原 HTML 内联样式里读回，界面上的图不受影响。
// 尺寸要从原始节点量：克隆出来的节点没挂到文档上，getBBox 取不到值。
function flattenForeignObjects(original) {
  const clone = original.cloneNode(true)
  const from = [...original.querySelectorAll('foreignObject')]
  const to = [...clone.querySelectorAll('foreignObject')]
  to.forEach((node, index) => {
    const source = from[index]
    const box = source?.getBBox?.() ?? { x: 0, y: 0, width: 0, height: 0 }
    const label = source.textContent.replace(/\s+/g, ' ').trim()
    const style = source.querySelector('span, div')?.getAttribute('style') || ''
    const fill = /color:\s*([^;]+)/.exec(style)?.[1]?.trim() || css('--la-text')
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', String(box.x + box.width / 2))
    text.setAttribute('y', String(box.y + box.height / 2))
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'central')
    text.setAttribute('fill', fill)
    text.setAttribute('font-size', '14px')
    text.setAttribute('font-family', css('--la-font-reading'))
    text.textContent = label
    node.replaceWith(text)
  })
  return clone
}

// SVG 里的颜色是烧死的具体色值，直接画进 canvas 就是所见图；
// 底色铺和屏幕上图表块同一层（--la-bg），看到什么就存下什么，粘到别处不是透明底。
function svgToPng(svg) {
  return new Promise(resolve => {
    const clone = flattenForeignObjects(svg)
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }))
    const image = new Image()
    image.onload = () => {
      try {
        // 尺寸用 SVG 自己的固有尺寸：先取 viewBox，再退到 width/height 属性。
        // 不用 getBoundingClientRect——屏幕上套了 max-width: 100% 会被压缩，导出会跟着变小变糊。
        const ratio = Math.max(1, window.devicePixelRatio || 1)
        const view = svg.viewBox?.baseVal
        const width = (view?.width || Number(svg.getAttribute('width')) || image.naturalWidth) || 1
        const height = (view?.height || Number(svg.getAttribute('height')) || image.naturalHeight) || 1
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * ratio))
        canvas.height = Math.max(1, Math.round(height * ratio))
        const context = canvas.getContext('2d')
        context.fillStyle = css('--la-layer-01')   // 与屏幕上图表卡的底色同一层，看到的和存下的一致
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch { resolve(null) } finally { URL.revokeObjectURL(url) }
    }
    image.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    image.src = url
  })
}

async function copyImage() {
  const svg = pickSvg()
  if (!svg) return Notice.show('还没有可复制的图表')
  const png = await svgToPng(svg)
  try {
    if (png) await navigator.clipboard.write([new ClipboardItem({ 'image/png': await (await fetch(png)).blob() })])
    else await navigator.clipboard.writeText(new XMLSerializer().serializeToString(svg)) // 浏览器拒绝画布导出时退回矢量源
    flashOrNotice(png ? '已复制图表图片' : '浏览器不允许复制图片，已复制 SVG 源码')
  } catch {
    flashOrNotice('复制失败，浏览器拒绝了剪贴板写入')
  }
}

async function saveImage() {
  const svg = pickSvg()
  if (!svg) return Notice.show('还没有可下载的图表')
  const png = await svgToPng(svg)
  const link = document.createElement('a')
  if (png) {
    link.href = png
    link.download = '图表.png'
  } else {
    link.href = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }))
    link.download = '图表.svg'
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }
  link.click()
  flashOrNotice(png ? '已下载图表图片' : '已下载图表 SVG')
}
</script>
<template>
  <figure class="ui-code-block">
    <figcaption>
      <span>{{ language }}</span>
      <span class="ui-code-block__actions">
        <Button v-if="isMermaid && diagram" icon variant="text" size="small" label="复制图表图片" @click="copyImage"><Icon name="image" :size="16" /></Button>
        <Button v-if="isMermaid && diagram" icon variant="text" size="small" label="全屏查看图表" @click="fullscreen = true"><Icon name="fullscreen" :size="16" /></Button>
        <Button variant="text" size="small" :aria-label="status === '已复制' ? '已复制' : '复制代码'" @click="copy">{{ status }}</Button>
      </span>
    </figcaption>
    <div v-if="isMermaid && diagram" ref="mermaidBox" class="ui-code-block__mermaid">
      <button class="ui-code-block__mermaid-view" type="button" aria-label="全屏查看图表" title="点击全屏查看" @click="fullscreen = true" v-html="diagram"></button>
    </div>
    <!-- 虚拟行重新挂载后立即绘制；这里只留一小块过渡占位，不再按源码行数估算大块空白。 -->
    <div v-else-if="isMermaid && !diagramError" class="ui-code-block__mermaid-placeholder" :style="{ minHeight: placeholderHeight }">
      <span>正在绘制图表…</span>
    </div>
    <div v-else class="ui-code-block__body">
      <p v-if="diagramError" class="ui-code-block__mermaid-error">{{ diagramError }}</p>
      <pre v-if="lineNumbers" class="ui-code-block__numbers" aria-hidden="true">{{ code.split('\n').map((_, index) => index + 1).join('\n') }}</pre>
      <pre><code v-html="highlighted"></code></pre>
    </div>
    <Dialog v-if="diagram" v-model:open="fullscreen" placement="center" plain aria-label="图表全屏查看">
      <div class="ui-code-block__fullscreen" @wheel.prevent="onWheel">
        <div ref="stage" class="ui-code-block__stage" @click="closeOnEmpty">
          <div class="ui-code-block__canvas" :style="viewStyle" v-html="diagram" @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragEnd"></div>
        </div>
        <div class="ui-code-block__zoombar">
          <Button icon variant="text" label="缩小" :disabled="scale <= MIN_SCALE" @click="nudge(-1)"><Icon name="zoom-out" :size="18" /></Button>
          <button class="ui-code-block__zoom-value" type="button" title="点击复位" @click="resetView">{{ Math.round(scale * 100) }}%</button>
          <Button icon variant="text" label="放大" :disabled="scale >= MAX_SCALE" @click="nudge(1)"><Icon name="zoom-in" :size="18" /></Button>
          <Button icon variant="text" label="复位视图" @click="resetView"><Icon name="refresh" :size="18" /></Button>
          <Button icon variant="text" label="复制图表图片" @click="copyImage"><Icon name="image" :size="18" /></Button>
          <Button icon variant="text" label="下载图表" @click="saveImage"><Icon name="download" :size="18" /></Button>
        </div>
        <p v-if="flash" class="ui-code-block__flash" role="status">{{ flash }}</p>
      </div>
    </Dialog>
  </figure>
</template>
<style scoped lang="scss" src="../styles/ui/CodeBlock.scss"></style>
