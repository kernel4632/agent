<!--
图标适配层：把应用里稳定的图标名映射到 Hugeicons，其余代码只写 name。
新增图标只改下面 icons 表：左边是应用内名称，右边是 Hugeicons 导出。
调用示例：<Icon name="settings" />、<Icon name="info" :size="16" />
-->
<script setup>
import { computed } from 'vue'
import { HugeiconsIcon } from '@hugeicons/vue'
import { BrainIcon, Image01Icon, TextIcon, ToolsIcon } from '@hugeicons/core-free-icons'
// 以 14px→1.3px、18px→2px 两个实际尺寸为锚点做线性过渡。
// 小图标保持底栏合适的细度，顶栏恢复到之前的 2px，大图标不再继续变粗。
const MIN_SIZE = 14
const DESIGN_SIZE = 18
const DESIGN_STROKE = 2
const MIN_STROKE = 1.3
import { Add01Icon, Activity01Icon, MinusSignIcon, AiBrain01Icon, ArrowDown01Icon, ArrowDown02Icon, ArrowExpand01Icon, ArrowRight01Icon, ArrowShrink01Icon, ArrowTurnBackwardIcon, ArrowUp02Icon, Attachment01Icon, Brain02Icon, BulbChargingIcon, BulbIcon, Cancel01Icon, ChartColumnIcon, ChatBotIcon, CheckListIcon, Clock01Icon, CodeIcon, Copy01Icon, Database01Icon, Delete01Icon, Download01Icon, EyeIcon, File02Icon, FlashIcon, Folder01Icon, GaugeIcon, GitForkIcon, Grid2X2PlusIcon, Home01Icon, Idea01Icon, IdeaIcon, InLoveIcon, InformationCircleIcon, InternetIcon, Layers01Icon, LeftToRightListBulletIcon, LightbulbOffIcon, Link01Icon, LookTopIcon, Menu03Icon, Message01Icon, MessageAdd01Icon, MoreVerticalIcon, PencilEdit01Icon, PlayIcon, Refresh01Icon, Search01Icon, Settings03Icon, Shield01Icon, Sorting01Icon, SparklesIcon, Tick02Icon, Upload01Icon, VolumeHighIcon, VolumeOffIcon, ZoomInAreaIcon, ZoomOutAreaIcon, } from '@hugeicons/core-free-icons'

const props = defineProps({ name: { type: String, default: 'spark' }, size: { type: [Number, String], default: 20 }, stroke: { type: [Number, String], default: 0 } })
const strokeWidth = computed(() => {
  if (Number(props.stroke)) return Number(props.stroke)
  const size = Number(props.size) || 18
  const progress = Math.min(1, Math.max(0, (size - MIN_SIZE) / (DESIGN_SIZE - MIN_SIZE)))
  const scaled = MIN_STROKE + (DESIGN_STROKE - MIN_STROKE) * progress
  return Number(scaled.toFixed(2))
})

// Names are kept stable for the rest of the app; the artwork is all Hugeicons.
const icons = {
  spark: SparklesIcon,
  plus: Add01Icon,
  'new-chat': MessageAdd01Icon,
  home: Home01Icon,
  search: Search01Icon,
  chat: Message01Icon,
  folder: Folder01Icon,
  settings: Settings03Icon,
  list: LeftToRightListBulletIcon,
  panel: LeftToRightListBulletIcon,
  menu: Menu03Icon,
  close: Cancel01Icon,
  arrow: ArrowRight01Icon,
  up: ArrowUp02Icon,
  down: ArrowDown01Icon,
  input: ArrowUp02Icon,
  output: ArrowDown02Icon,
  'cache-read': Download01Icon,
  'cache-write': Upload01Icon,
  code: CodeIcon,
  document: File02Icon,
  globe: InternetIcon,
  clock: Clock01Icon,
  layers: Layers01Icon,
  database: Database01Icon,
  refresh: Refresh01Icon,
  activity: Activity01Icon,
  flash: FlashIcon,
  gauge: GaugeIcon,
  edit: PencilEdit01Icon,
  trash: Delete01Icon,
  copy: Copy01Icon,
  undo: ArrowTurnBackwardIcon,
  branch: GitForkIcon,
  stop: Cancel01Icon,
  paperclip: Attachment01Icon,
  check: Tick02Icon,
  minus: MinusSignIcon,
  todo: CheckListIcon,
  permission: Shield01Icon,
  mode: AiBrain01Icon,
  model: Brain02Icon,
  idea: Idea01Icon,
  text: TextIcon,
  image: Image01Icon,
  tools: ToolsIcon,
  reasoning: BrainIcon,
  info: InformationCircleIcon,
  link: Link01Icon,
  eye: EyeIcon,
  'grid-plus': Grid2X2PlusIcon,
  sort: Sorting01Icon,
  more: MoreVerticalIcon,
  assistant: ChatBotIcon,
  favorite: InLoveIcon,
  stats: ChartColumnIcon,
  fullscreen: ArrowExpand01Icon,
  'zoom-in': ZoomInAreaIcon,
  'zoom-out': ZoomOutAreaIcon,
  collapse: ArrowShrink01Icon,
  'thinking-off': LightbulbOffIcon,
  'thinking-auto': Idea01Icon,
  'thinking-low': IdeaIcon,
  'thinking-medium': BulbIcon,
  'thinking-high': BulbChargingIcon,
  'thinking-xhigh': BulbChargingIcon,
  'thinking-max': BulbChargingIcon,
  volume: VolumeHighIcon,
  'volume-off': VolumeOffIcon,
  download: Download01Icon,
  play: PlayIcon,
}
</script>

<template>
  <HugeiconsIcon class="ui-icon" :icon="icons[name] || SparklesIcon" :size="Number(size)" :stroke-width="strokeWidth" aria-hidden="true" />
</template>

<style scoped lang="scss" src="../styles/ui/Icon.scss"></style>
