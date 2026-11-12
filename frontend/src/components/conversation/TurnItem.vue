<!-- 时间线中的一轮；用户消息和助手回复共用步骤窄条，右键保持浏览器原生。 -->
<script setup>
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import CompactionNotice from '../feedback/CompactionNotice.vue'
import AssistantTurn from './AssistantTurn.vue'
import { computed } from 'vue'
import { isSavedMessage } from '../../features/turns.js'

const props = defineProps({
  turn: { type: Object, required: true },
  sessionId: { type: String, required: true },
  active: Boolean,
})
const userActionTarget = computed(() => isSavedMessage(props.turn.messages[0]) ? props.turn.messages[0] : null)
</script>

<template>
  <article
    class="message"
    :class="[`message--${turn.role}`, { 'message--compact': turn.messages[0].compact }]"
    :aria-label="turn.messages[0].compact ? '上下文压缩' : turn.role === 'user' ? '你的消息' : 'Agent 的回复'"
  >
    <CompactionNotice v-if="turn.messages[0].compact" :content="turn.messages[0].content" />
    <template v-else-if="turn.role === 'user'">
      <div
        class="message-step"
        data-cut-row
        :data-cut-message-id="userActionTarget?.id || ''"
        data-cut-kind="user"
        data-cut-label="用户消息操作"
        :data-step-key="`user-${turn.messages[0].id}`"
        :data-step-rollback="userActionTarget?.id || ''"
        :data-step-fork="userActionTarget?.id || ''"
        data-step-label="用户消息操作"
      >
        <div class="message-step__body">
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
        </div>
      </div>
    </template>
    <template v-else>
      <AssistantTurn
        :messages="turn.messages"
        :session-id="sessionId"
        :active="active"
      />
    </template>
  </article>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/TurnItem.scss"></style>
