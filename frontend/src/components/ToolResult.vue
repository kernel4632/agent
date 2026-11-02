<!--
  工具结果分发：工具脚本的 ui.view 决定使用哪个独立视图。
  视图、操作和样式都按职责拆开，这里只做查表，不再堆条件分支。
  调用示例：<ToolResult :tool="tool" />
-->
<script setup>
import { computed } from 'vue'
import { uiFor } from '../commands/tool.js'
import ToolActions from './ToolActions.vue'
import TodoView from './results/TodoView.vue'
import CommandView from './results/CommandView.vue'
import SearchView from './results/SearchView.vue'
import FileListView from './results/FileListView.vue'
import EditView from './results/EditView.vue'
import ResultView from './results/ResultView.vue'
import WebView from './results/WebView.vue'
import SubtaskView from './results/SubtaskView.vue'
import PatchView from './results/PatchView.vue'
import FileView from './results/FileView.vue'
import GenericView from './results/GenericView.vue'


const props = defineProps({ tool: { type: Object, required: true } })

const views = {
  todo: TodoView,
  command: CommandView,
  search: SearchView,
  'file-list': FileListView,
  edit: EditView,
  completion: ResultView,
  question: ResultView,
  web: WebView,
  subtask: SubtaskView,
  patch: PatchView,
  'file-read': FileView,
  'file-write': FileView,
}

const view = computed(() => views[uiFor(props.tool.name).view] || GenericView)
</script>

<template>
  <div class="tool-view">
    <component :is="view" :tool="tool" />
    <ToolActions :tool="tool" />
  </div>
</template>

<style lang="scss" src="../styles/components/ToolResult.scss"></style>
