<!--
命令面板：搜索并执行命令或打开会话。
查询文本、选中索引和键盘操作都在组件内部处理；items 传入完整列表，选中后通过 select 交给调用方执行和关闭。
调用示例：<CommandPalette v-model:open="paletteOpen" :items="paletteItems" @select="runPalette" />
-->
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import Button from '../../ui/Button.vue'

const props = defineProps({
  open: Boolean,                                        // 面板是否显示
  items: { type: Array, default: () => [] },            // 每项包含 id、label、hint，label 和 hint 参与搜索
})

const emit = defineEmits(['update:open', 'select'])

const query = ref('')
const index = ref(0)
const input = ref(null)
let previousFocus = null

// 搜索范围和原来一致：标题或提示包含关键词就保留，最多显示 12 条。
const visibleItems = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return props.items
    .filter(item => !keyword || item.label.toLowerCase().includes(keyword) || (item.hint || '').toLowerCase().includes(keyword))
    .slice(0, 12)
})

// 每次打开都清空查询和选中项，等面板渲染后聚焦搜索框；关闭后把焦点还给打开前的元素。
watch(() => props.open, async open => {
  if (!open) {
    if (previousFocus?.isConnected) previousFocus.focus()
    previousFocus = null
    return
  }
  previousFocus = document.activeElement
  query.value = ''
  index.value = 0
  await nextTick()
  input.value?.focus()
}, { immediate: true })

// 关键词一变，列表内容就变，选中项回到第一条，避免回车拿到已不存在的项。
watch(query, () => { index.value = 0 })

// 方向键循环切换；回车执行当前项；Esc 关闭；Tab 留在面板内。输入法组合中的回车不处理。
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); emit('update:open', false); return }
  if (event.key === 'Tab') { event.preventDefault(); input.value?.focus(); return }
  if (!visibleItems.value.length) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    index.value = (index.value + 1) % visibleItems.value.length
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    index.value = (index.value - 1 + visibleItems.value.length) % visibleItems.value.length
    return
  }
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault()
    emit('select', visibleItems.value[index.value])
  }
}
</script>

<template>
  <Transition name="palette">
    <div v-if="open" class="command-palette" role="dialog" aria-modal="true" aria-label="命令面板" @click.self="emit('update:open', false)" @keydown="keydown">
    <div class="command-palette__panel">
      <!-- 搜索框是命令面板专用输入，保留原生以直接聚焦和即时过滤；后续换成搜索控件。 -->
      <input
        ref="input"
        v-model="query"
        class="command-palette__input"
        type="search"
        role="combobox"
        aria-label="搜索命令"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="command-palette-list"
        :aria-activedescendant="visibleItems[index] ? `command-palette-option-${index}` : undefined"
        placeholder="搜索命令或会话"
      />
      <div id="command-palette-list" class="command-palette__list" role="listbox" aria-label="命令">
        <!-- 命令项只换 Button 外壳，role、选中状态和 activedescendant 指向同一项。 -->
        <Button v-for="(item, itemIndex) in visibleItems" :id="`command-palette-option-${itemIndex}`" :key="item.id" variant="plain" class="command-palette__item" :class="{ 'is-active': itemIndex === index }" role="option" tabindex="-1" :aria-selected="itemIndex === index" @click="emit('select', item)">
          <span>{{ item.label }}</span><small>{{ item.hint }}</small>
        </Button>
        <p v-if="!visibleItems.length" class="command-palette__empty">没有匹配的命令</p>
      </div>
    </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss" src="../../styles/components/navigation/CommandPalette.scss"></style>
