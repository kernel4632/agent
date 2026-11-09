<!-- 时间线中的一轮；虚拟化历史区和始终挂载的 live tail 共用同一份渲染。 -->
<script setup>
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import MessageActions from './MessageActions.vue'
import CompactionNotice from '../feedback/CompactionNotice.vue'
import AssistantTurn from './AssistantTurn.vue'

const props = defineProps({
  turn: { type: Object, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
  active: Boolean,
  live: Boolean,
  rollbackTarget: { type: Object, default: null },
  rollbackPreview: { type: Object, default: null },
  menuItems: { type: Function, required: true },
})
const emit = defineEmits(['request-rollback', 'close', 'action', 'rollback-confirm', 'fork'])
</script>

<template>
  <article
    class="message"
    :class="[`message--${turn.role}`, { 'message--compact': turn.messages[0].compact }]"
    :aria-label="turn.messages[0].compact ? '上下文压缩' : turn.role === 'user' ? '你的消息' : 'Agent 的回复'"
  >
    <CompactionNotice v-if="turn.messages[0].compact" :content="turn.messages[0].content" />
    <template v-else-if="turn.role === 'user'">
      <MessageActions
        :items="menuItems(turn.messages[0])"
        :target-id="turn.messages[0].id"
        label="消息操作"
        :running="running"
        :rollback-target="rollbackTarget"
        :rollback-preview="rollbackPreview"
        @request-open="emit('request-rollback', turn.messages[0])"
        @close="emit('close')"
        @action="emit('action', turn.messages[0], $event)"
        @rollback-confirm="emit('rollback-confirm', $event)"
      >
        <div class="rikka-message rikka-message--user">
          <div class="rikka-bubble rikka-bubble--user" :data-message-id="turn.messages[0].id">
            <Markdown :content="turn.messages[0].displayContent ?? turn.messages[0].content" />
            <div v-if="turn.messages[0].images?.length" class="user-images">
              <img v-for="(image, index) in turn.messages[0].images" :key="index" :src="image" alt="用户发送的图片" class="user-images__thumb" />
            </div>
            <div v-if="turn.messages[0].attachments?.length" class="user-attachments">
              <span v-for="(file, index) in turn.messages[0].attachments" :key="file.id || `${index}-${file.name}`" class="user-attachment" :title="file.name">
                <Icon name="document" :size="14" />
                <span class="user-attachment__name">{{ file.name }}</span>
              </span>
            </div>
          </div>
        </div>
      </MessageActions>
    </template>
    <template v-else>
      <AssistantTurn
        :messages="turn.messages"
        :session-id="sessionId"
        :running="running"
        :active="active"
        :live="live"
        :rollback-target="rollbackTarget"
        :rollback-preview="rollbackPreview"
        @rollback="emit('request-rollback', $event)"
        @fork="emit('fork', $event)"
        @rollback-confirm="emit('rollback-confirm', $event)"
      />
    </template>
  </article>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/TurnItem.scss"></style>
