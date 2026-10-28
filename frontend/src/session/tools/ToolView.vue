<!--
  工具结果分发：工具脚本的 ui.view 决定使用哪个独立视图。
  视图、操作和样式都按职责拆开，这里只做查表，不再堆条件分支。
  调用示例：<ToolView :tool="tool" />
-->
<script setup>
import { computed } from 'vue'
import { uiFor } from '../tool-ui.js'
import ToolActions from './ToolActions.vue'
import TodoView from './views/TodoView.vue'
import CommandView from './views/CommandView.vue'
import SearchView from './views/SearchView.vue'
import FileListView from './views/FileListView.vue'
import EditView from './views/EditView.vue'
import ResultView from './views/ResultView.vue'
import WebView from './views/WebView.vue'
import SubtaskView from './views/SubtaskView.vue'
import PatchView from './views/PatchView.vue'
import FileView from './views/FileView.vue'
import GenericView from './views/GenericView.vue'
import './tool-views.scss'

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
