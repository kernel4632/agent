<!--
会话页：把顶部、时间线、输入区、文件面板和运行设置组装成完整的一页。
只负责会话自己的交互；打开/关闭标签、草稿页和全局快捷键仍由 App.vue 管。
调用示例：
<SessionView
  v-else
  :session="session"
  :workspace="selectedWorkspace"
  :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
/>
-->
<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import Composer from '../composer/Composer.vue'
import SessionHeader from './SessionHeader.vue'
import SessionFilePanel from './SessionFilePanel.vue'
import { store } from '../store.js'
import { Session, AUTO_APPROVE_KINDS, USE_LABELS } from '../commands/session.js'
import { Chat } from '../commands/chat.js'
import { UI } from '../commands/ui.js'

// 时间线单独拆包，只有进入会话页时才加载。
const Timeline = defineAsyncComponent(() => import('./Timeline.vue'))

const props = defineProps({
  session: { type: Object, required: true }, // 当前打开的完整会话
  workspace: Object,                         // 会话所属工作区，给顶部和文件面板使用
  busy: Boolean,                             // 创建中、加载中或有连接错误时禁止发送
})

// --- 页面内的开关 ---
const reviewOpen = ref(false)
// "更多"面板默认收起：常用的是上面那几个开关，这里都是配一次就不动的。
const moreOpen = ref(false)

// --- 输入草稿和附件 ---
// 草稿放在 session 上，切标签或打开设置再回来不会丢。
const draft = computed({
  get: () => props.session.draft,
  set: value => { props.session.draft = value },
})
const files = computed(() => props.session.files || [])

// --- 发送与停止 ---
async function submitMessage(content) {
  if (props.busy) return
  if (await Chat.send(props.session.id, content)) {
    // 发送期间用户可能又输入了新内容，只清掉刚发出去的那份。
    if (props.session.draft === content) props.session.draft = ''
  }
}

function stop() { void Chat.stop(props.session.id) }

// --- 附件 ---
function attachFiles(selected) { void Chat.attach(props.session.id, selected) }
function removeFile(id) { Chat.removeFile(props.session.id, id) }

// --- 顶部模型切换 ---
// 所有供应商下的所有模型，按"供应商/模型"给出，供下拉框选。
const allModels = () => Object.entries(store.config.providers || {})
  .flatMap(([provider, entry]) => (entry.models || []).map(model => ({ provider, model })))

// 会话顶部模型下拉框的选项；当前模型不在配置里时也保留一条，避免选择框显示空白。
const modelOptions = computed(() => {
  const list = allModels()
  const current = `${props.session.provider}/${props.session.model}`
  if (current && !list.some(item => `${item.provider}/${item.model}` === current)) {
    list.unshift({ provider: props.session.provider, model: props.session.model })
  }
  return list
})

async function switchModel(value) {
  if (!value) return
  const [provider, ...rest] = value.split('/')
  const model = rest.join('/')
  if (provider === props.session.provider && model === props.session.model) return
  await Session.selectModel(props.session.id, provider, model)
}

// --- 自动批准和按用途模型 ---
const autoApproveCount = computed(() => AUTO_APPROVE_KINDS.filter(item => props.session.settings.autoApprove?.[item.kind]).length)

// 某一件事当前选的是哪个模型；没单独配过就是空串（＝和主模型共用）。
const useKey = (session, use) => {
  const target = session.settings.uses?.[use]
  return target ? `${target.provider}/${target.model}` : ''
}

// 把下拉框的值翻回后端认的 { provider, model }；空串表示改回共用。
const targetFrom = (session, value) => {
  if (!value) return null
  const [provider, ...rest] = value.split('/')
  return { provider, model: rest.join('/') }
}
</script>

<template>
  <section class="panel session-panel" aria-label="聊天">
    <SessionHeader v-model:review-open="reviewOpen" :session="session" :workspace="workspace" :models="modelOptions" @switch-model="switchModel" />
    <div class="session-body">
      <div class="session-main">
        <div class="session-scroll">
          <Timeline :key="session.id" />
        </div>
        <div class="session-composer">
          <div v-if="!session.model" class="chat-notice"><span>此对话还未配置模型。</span><button class="text-button" @click="UI.openSettings('providers')">连接模型</button></div>
          <div v-if="moreOpen" class="chat-more">
            <section class="chat-more__group" aria-label="自动批准">
              <h2>自动批准</h2>
              <p>按类别跳过审批；.agentignore 仍然生效。</p>
              <div class="chat-more__chips">
                <button v-for="item in AUTO_APPROVE_KINDS" :key="item.kind" class="chip chip--compact" :class="{ 'chip--active': session.settings.autoApprove?.[item.kind] }" :title="`自动批准「${item.label}」：${item.hint}`" @click="Session.toggleAutoApprove(session.id, item.kind)"><AppIcon :name="item.icon" :size="12" />{{ item.label }}</button>
              </div>
            </section>
            <section class="chat-more__group" aria-label="模型能力">
              <h2>模型能力</h2>
              <p>按模型支持情况开关。</p>
              <div class="chat-more__chips">
                <button class="chip chip--compact" :class="{ 'chip--active': session.settings.capabilities.image }" title="允许把图片发给模型" @click="Session.toggleCapability(session.id, 'image')"><AppIcon name="globe" :size="12" />图像</button>
                <button class="chip chip--compact" :class="{ 'chip--active': session.settings.capabilities.cache }" title="提示词缓存，命中就是省时间和省钱" @click="Session.toggleCapability(session.id, 'cache')"><AppIcon name="copy" :size="12" />缓存</button>
                <button class="chip chip--compact" :class="{ 'chip--active': session.settings.capabilities.stream }" title="流式输出：回复边生成边显示" @click="Session.toggleCapability(session.id, 'stream')"><AppIcon name="spark" :size="12" />流式</button>
                <button class="chip chip--compact" :class="{ 'chip--active': session.settings.autoTitle }" title="第一次聊完让模型起个标题" @click="Session.toggleAutoTitle(session.id)"><AppIcon name="edit" :size="12" />自动标题</button>
              </div>
            </section>
            <section class="chat-more__group" aria-label="按用途指定模型">
              <h2>哪件事用哪个模型</h2>
              <p>不选就和主模型（{{ session.model }}）共用</p>
              <label v-for="(label, use) in USE_LABELS" :key="use" class="chat-more__row">
                <span>{{ label }}</span>
                <select :value="useKey(session, use)" @change="Session.setUse(session.id, use, targetFrom(session, $event.target.value))">
                  <option value="">和主模型共用</option>
                  <option v-for="item in allModels()" :key="`${item.provider}/${item.model}`" :value="`${item.provider}/${item.model}`">{{ item.provider }} / {{ item.model }}</option>
                </select>
              </label>
            </section>
            <section class="chat-more__group" aria-label="自动批准的刹车">
              <h2>自动批准的上限</h2>
              <p>连着自动批准这么多次就停下来问一句；填 0 表示不设上限</p>
              <label class="chat-more__row"><span>连续次数</span>
                <input type="number" min="0" :value="session.settings.autoApproveLimit" @change="Session.setLimit(session.id, Number($event.target.value))" />
              </label>
            </section>
            <section class="chat-more__group" aria-label="上下文压缩">
              <h2>自动压缩</h2>
              <p>上下文用到这个比例时自动总结；范围 0.1 到 0.99</p>
              <label class="chat-more__row"><span>阈值</span>
                <input type="number" min="0.1" max="0.99" step="0.05" :value="session.settings.compactThreshold ?? 0.8" @change="Session.setCompactThreshold(session.id, Number($event.target.value))" />
              </label>
            </section>
          </div>
          <div v-if="session.connection === 'reconnecting'" class="chat-notice" role="status">连接中断，正在重连…</div>
          <div v-if="session.undoable" class="chat-notice"><span>对话已回退{{ session.undoable > 1 ? `（可撤销 ${session.undoable} 步，发新消息后不能再撤销）` : '' }}</span><button class="text-button" @click="Chat.undoRollback(session.id)">撤销回退</button></div>
          <Composer v-model:draft="draft" :selected-model="session.model" :can-select-model="false" :is-running="session.status === 'running'" :busy="busy" :files="files" :context-tokens="session.contextTokens || 0" @submit="submitMessage" @stop="stop" @attach="attachFiles" @remove-file="removeFile">
            <template #status>
              <button type="button" class="composer-mode" aria-label="切换模式" :class="{ 'is-active': session.settings.mode !== 'build' }" :disabled="session.status === 'running'" :title="session.status === 'running' ? '任务运行中，停止后才能切换模式' : '点击切换模式'" @click="Session.toggleMode(session.id)"><AppIcon name="eye" :size="12" />{{ Session.modeLabel(session.settings.mode) }}</button>
              <button type="button" class="composer-mode composer-mode--auto" aria-label="自动批准和模型能力" :class="{ 'is-active': autoApproveCount > 0 }" :aria-expanded="moreOpen" title="自动批准和模型能力" @click="moreOpen = !moreOpen"><AppIcon name="check" :size="12" /><span class="composer-mode__label">自动批准 {{ autoApproveCount }}/{{ AUTO_APPROVE_KINDS.length }}</span></button>
            </template>
          </Composer>
        </div>
      </div>
      <SessionFilePanel v-model:open="reviewOpen" :session="session" :workspace="workspace" />
    </div>
  </section>
</template>

<style scoped lang="scss">
.session-panel { display: flex; flex-direction: column; }
.session-body { display: flex; min-height: 0; flex: 1; }
.session-main { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.session-scroll { min-height: 0; flex: 1; overflow: auto; }
.session-composer { width: 100%; max-width: var(--la-chat-width); flex: none; margin: 0 auto; padding: 8px 20px 16px; }
.chat-notice { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 6px 9px; border-radius: 6px; background: var(--la-layer-01); color: var(--la-secondary); font-size: 13px; }
.chat-more { display: flex; flex-wrap: wrap; gap: 20px; max-height: 340px; margin-bottom: 8px; padding: 16px; overflow-y: auto; border-radius: 8px; background: var(--la-layer-01); box-shadow: inset 0 0 0 .5px var(--la-line); }
.chat-more__group { flex: 1 1 240px; min-width: 0; }
.chat-more__group h2 { margin: 0; color: var(--la-text); font-size: 13px; font-weight: 530; line-height: 16px; }
.chat-more__group p { margin: 6px 0 10px; color: var(--la-muted); font-size: 13px; font-weight: 440; line-height: 20px; }
.chat-more__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chat-more__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; color: var(--la-secondary); font-size: 13px; }
.chat-more__row select, .chat-more__row input { max-width: 150px; min-width: 0; height: 28px; padding: 0 7px; border: .5px solid var(--la-line); border-radius: 4px; background: var(--la-panel); color: var(--la-text); font-size: 12px; }
.chip { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; padding: 2px 7px; border: 0; border-radius: 4px; background: var(--la-layer-02); color: var(--la-muted); font-size: 12px; cursor: pointer; }
.chip:hover:not(:disabled) { color: var(--la-text); background: var(--la-layer-03); }
.chip--active { background: var(--la-accent-soft); color: var(--la-accent); }
.chip:disabled { opacity: .5; }
.chip--compact { min-height: 22px; padding: 1px 6px; }
.composer-mode { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px; border: 0; border-radius: 4px; background: transparent; color: var(--la-muted); font-size: 12px; font-weight: 440; cursor: pointer; }
.composer-mode:hover:not(:disabled) { background: var(--la-hover); color: var(--la-text); }
.composer-mode.is-active { color: var(--la-accent); }
.composer-mode:disabled { opacity: .5; }
@media (max-width: 767px) {
  .session-composer { padding: 6px 8px max(10px, env(safe-area-inset-bottom)); }
  .chat-more { gap: 16px; padding: 12px; }
  .composer-mode { white-space: nowrap; flex-shrink: 0; font-size: 10px; }
  .composer-mode--auto .composer-mode__label { display: none; }
}
</style>
