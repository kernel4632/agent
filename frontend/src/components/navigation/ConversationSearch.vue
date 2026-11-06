<!--
聊天记录搜索：原生 dialog 负责遮罩、模糊背景、焦点圈定和进出场动画。
弹窗关闭时组件不卸载，所以查询、当前结果和列表滚动位置会原样保留。
调用示例：<ConversationSearch :open="searchOpen" :session="session" @close="searchOpen = false" @select="jumpToSearchResult" />
-->
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import Dialog from '../../ui/Dialog.vue'
import Button from '../../ui/Button.vue'
import Icon from '../../ui/Icon.vue'
import { searchConversation } from '../../features/conversation-search.js'

const props = defineProps({
  open: Boolean,
  session: { type: Object, default: null },
})
const emit = defineEmits(['close', 'select'])
const query = ref('')
const activeIndex = ref(0)
const input = ref(null)
const list = ref(null)
const messages = computed(() => props.session?.messages || [])
const results = computed(() => searchConversation(messages.value, query.value))
const activeResult = computed(() => results.value[activeIndex.value] || null)

watch(() => props.open, async open => {
  if (!open) return
  await nextTick()
  // 等原生 dialog 完成 showModal 后再聚焦，避免焦点被关闭按钮抢走。
  requestAnimationFrame(() => input.value?.focus({ preventScroll: true }))
})

// 切换会话时旧结果没有意义；同一会话的多轮开关不重置。
watch(() => props.session?.id, () => {
  query.value = ''
  activeIndex.value = 0
  if (list.value) list.value.scrollTop = 0
})

// 输入新关键词才回到结果顶部；重新打开不改动当前位置。
watch(query, async () => {
  activeIndex.value = 0
  await nextTick()
  if (list.value) list.value.scrollTop = 0
})

watch(() => results.value.length, length => {
  if (activeIndex.value >= length) activeIndex.value = Math.max(0, length - 1)
})

function onOpenChange(open) {
  if (!open) emit('close')
}

function choose(result = activeResult.value) {
  if (!result) return
  emit('select', result.id)
}

async function move(step) {
  if (!results.value.length) return
  activeIndex.value = Math.min(results.value.length - 1, Math.max(0, activeIndex.value + step))
  await nextTick()
  list.value?.querySelector(`[data-search-index="${activeIndex.value}"]`)?.scrollIntoView({ block: 'nearest' })
}

function onEnter(event) {
  if (event.isComposing) return
  choose()
}
</script>

<template>
  <Dialog :open="open" class="conversation-search-dialog" label="搜索聊天记录" @update:open="onOpenChange">
    <template #header>
      <div class="conversation-search__field">
        <Icon name="search" :size="18" />
        <input
          ref="input"
          v-model="query"
          type="text"
          aria-label="搜索聊天记录"
          placeholder="搜索聊天记录"
          autocomplete="off"
          spellcheck="false"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="onEnter"
        />
        <button v-if="query" class="conversation-search__clear" type="button" aria-label="清空搜索" @click="query = ''"><Icon name="close" :size="14" /></button>
      </div>
    </template>

    <div class="conversation-search">
      <div v-if="query" class="conversation-search__summary">
        <span>{{ results.length }} 条结果</span>
        <span class="conversation-search__hint">↑↓ 选择 · Enter 跳转</span>
      </div>
      <div ref="list" class="conversation-search__results">
        <Button
          v-for="(result, index) in results"
          :key="`${result.id}-${index}`"
          variant="plain"
          class="conversation-search__result"
          :class="{ 'is-active': index === activeIndex }"
          :data-search-index="index"
          @mouseenter="activeIndex = index"
          @focus="activeIndex = index"
          @click="choose(result)"
        >
          <span class="conversation-search__snippet">{{ result.before }}<mark>{{ result.match }}</mark>{{ result.after }}</span>
        </Button>
        <div v-if="!query" class="conversation-search__empty">
          <Icon name="search" :size="24" />
          <span>输入关键词搜索当前聊天记录</span>
        </div>
        <div v-else-if="!results.length" class="conversation-search__empty">
          <Icon name="search" :size="24" />
          <span>没有找到匹配内容</span>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped lang="scss" src="../../styles/components/navigation/ConversationSearch.scss"></style>
