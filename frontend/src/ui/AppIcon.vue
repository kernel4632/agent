<!--
图标适配层：把应用里稳定的图标名映射到 Hugeicons，其余代码只写 name。
新增图标只改下面 icons 表：左边是应用内名称，右边是 Hugeicons 导出。
调用示例：<AppIcon name="settings" />、<AppIcon name="info" :size="16" />
-->
<script setup>
import { HugeiconsIcon } from '@hugeicons/vue'
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  ArrowUp02Icon,
  Attachment01Icon,
  Cancel01Icon,
  ChartColumnIcon,
  Clock01Icon,
  CodeIcon,
  Copy01Icon,
  Delete01Icon,
  Download01Icon,
  EyeIcon,
  File02Icon,
  Folder01Icon,
  GitForkIcon,
  Grid2X2PlusIcon,
  Home01Icon,
  InLoveIcon,
  InformationCircleIcon,
  InternetIcon,
  LeftToRightListBulletIcon,
  Link01Icon,
  LookTopIcon,
  Maximize01Icon,
  Menu03Icon,
  Message01Icon,
  MessageAdd01Icon,
  MoreVerticalIcon,
  PencilEdit01Icon,
  Search01Icon,
  Settings03Icon,
  Sorting01Icon,
  SparklesIcon,
  Tick02Icon,
  VolumeHighIcon,
  VolumeOffIcon,
} from '@hugeicons/core-free-icons'

defineProps({ name: { type: String, default: 'spark' }, size: { type: [Number, String], default: 20 } })

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
  code: CodeIcon,
  document: File02Icon,
  globe: InternetIcon,
  clock: Clock01Icon,
  edit: PencilEdit01Icon,
  trash: Delete01Icon,
  copy: Copy01Icon,
  undo: ArrowTurnBackwardIcon,
  branch: GitForkIcon,
  stop: Cancel01Icon,
  paperclip: Attachment01Icon,
  check: Tick02Icon,
  info: InformationCircleIcon,
  link: Link01Icon,
  eye: EyeIcon,
  'grid-plus': Grid2X2PlusIcon,
  sort: Sorting01Icon,
  more: MoreVerticalIcon,
  assistant: LookTopIcon,
  favorite: InLoveIcon,
  stats: ChartColumnIcon,
  fullscreen: Maximize01Icon,
  volume: VolumeHighIcon,
  'volume-off': VolumeOffIcon,
  download: Download01Icon,
}
</script>

<template>
  <HugeiconsIcon :icon="icons[name] || SparklesIcon" :size="Number(size)" :stroke-width="1.7" />
</template>
