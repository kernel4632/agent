<!--
扩展页：列出项目和用户目录里的扩展，开关、重载，并显示依赖和加载错误。
开关和重载调用 features/extensions，前端注册的设置页和工具视图跟着自动出现或消失。
调用示例：<ExtensionList :draft="draft" />
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import Button from '../../ui/Button.vue'
import Icon from '../../ui/Icon.vue'
import Switch from '../../ui/Switch.vue'
import { Extensions, extensionState } from '../../features/extensions.js'

defineProps({ draft: { type: Object, default: null } })

const busy = ref('')
const loading = ref(true)
const items = computed(() => extensionState.value.extensions || [])

onMounted(async () => {
  await Extensions.refresh().catch(() => {})
  loading.value = false
})

// 关掉一个被依赖的扩展时，先说清楚会连带停掉哪些
async function toggle(item, enabled) {
  if (!enabled && item.dependents?.length && !window.confirm(`关闭 ${item.title} 会同时停用：${item.dependents.join('、')}。继续？`)) return
  busy.value = item.name
  await Extensions.toggle(item.name, enabled)
  busy.value = ''
}

async function reload(item) {
  busy.value = item.name
  await Extensions.reload(item.name)
  busy.value = ''
}

const statusText = item => {
  if (item.error) return item.error
  if (!item.enabled) return '已关闭'
  return item.running ? '运行中' : '未运行'
}
</script>

<template>
  <section class="extension-page" aria-label="扩展">
    <header class="extension-head">
      <p>扩展放在项目的 extensions/ 或 ~/.agents/extensions/ 里。关闭会立刻拔出它注入的工具、动作和界面；代码改动后点「重载」生效。</p>
    </header>

    <p v-if="loading && !items.length" class="extension-empty">正在读取扩展…</p>
    <p v-else-if="!items.length" class="extension-empty">还没有扩展。</p>

    <div v-else class="extension-card">
      <div v-for="item in items" :key="item.name" class="extension-row" :class="{ 'is-error': item.error }">
        <span class="extension-row__icon" aria-hidden="true"><Icon name="grid-plus" :size="20" /></span>
        <span class="extension-row__copy">
          <strong>{{ item.title }}<small v-if="item.version"> {{ item.version }}</small></strong>
          <small v-if="item.description">{{ item.description }}</small>
          <span class="extension-row__tags">
            <span class="extension-tag">{{ item.source === 'user' ? '用户目录' : '项目' }}</span>
            <span class="extension-tag" :class="{ 'extension-tag--error': item.error, 'extension-tag--on': item.running && !item.error }">{{ statusText(item) }}</span>
            <span v-if="item.changed" class="extension-tag extension-tag--warn">代码有更新</span>
            <span v-for="dep in item.requires" :key="dep" class="extension-tag">依赖 {{ dep }}</span>
          </span>
        </span>
        <span class="extension-row__actions">
          <Button variant="text" size="small" :disabled="busy === item.name || !item.enabled" @click="reload(item)">
            <Icon name="refresh" :size="16" />重载
          </Button>
          <Switch
            :model-value="item.enabled"
            :label="`启用 ${item.title}`"
            :disabled="busy === item.name"
            hide-label
            @update:model-value="toggle(item, $event)"
          />
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss" src="../../styles/components/capabilities/ExtensionList.scss"></style>
