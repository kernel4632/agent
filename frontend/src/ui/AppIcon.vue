<!--
图标适配层：把应用里稳定的图标名映射到 Hugeicons，其余代码只写 name。
新增图标只改下面 icons 表：左边是应用内名称，右边是 Hugeicons 导出。
调用示例：<AppIcon name="settings" />、<AppIcon name="info" :size="16" />
-->
<script setup>
import { HugeiconsIcon } from '@hugeicons/vue'
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Attachment01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  CodeIcon,
  Copy01Icon,
  Delete01Icon,
  EyeIcon,
  File01Icon,
  Folder01Icon,
  GitBranchIcon,
  GlobeIcon,
  Grid2X2PlusIcon,
  Home01Icon,
  InformationCircleIcon,
  Link01Icon,
  Menu01Icon,
  Message01Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
  PlusSignIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
  SparklesIcon,
  StopIcon,
  Undo02Icon,
} from '@hugeicons/core-free-icons'

defineProps({ name: { type: String, default: 'spark' }, size: { type: [Number, String], default: 20 } })

// Names are kept stable for the rest of the app; the artwork is all Hugeicons.
const icons = {
  spark: SparklesIcon,
  plus: PlusSignIcon,
  home: Home01Icon,
  search: Search01Icon,
  chat: Message01Icon,
  folder: Folder01Icon,
  settings: Settings01Icon,
  panel: SidebarLeft01Icon,
  menu: Menu01Icon,
  close: Cancel01Icon,
  arrow: ArrowRight01Icon,
  up: ArrowUp01Icon,
  down: ArrowDown01Icon,
  code: CodeIcon,
  document: File01Icon,
  globe: GlobeIcon,
  clock: Clock01Icon,
  edit: PencilEdit01Icon,
  trash: Delete01Icon,
  copy: Copy01Icon,
  undo: Undo02Icon,
  branch: GitBranchIcon,
  stop: StopIcon,
  paperclip: Attachment01Icon,
  check: CheckmarkCircle01Icon,
  info: InformationCircleIcon,
  link: Link01Icon,
  eye: EyeIcon,
  'grid-plus': Grid2X2PlusIcon,
  more: MoreHorizontalIcon,
}
</script>

<template>
  <HugeiconsIcon :icon="icons[name] || SparklesIcon" :size="Number(size)" :stroke-width="1.7" />
</template>
