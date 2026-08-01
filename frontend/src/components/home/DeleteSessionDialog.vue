<!--
删除确认弹窗：展示目标标题并发出确认或关闭意图。
组件不删除 Session，不读取 Store。
调用示例：<DeleteSessionDialog :session="target" @confirm="removeSession" />。
-->
<script setup>
import { t } from '../../i18n.js'                                      // 提供删除确认文案

defineProps({ session: { type: Object, default: null } })             // 当前待删除 Session
defineEmits(['close', 'confirm'])                                      // 将最终用户决定交回主页
</script>

<template>
  <m3e-dialog class="delete-session-dialog" :open="Boolean(session)" @closed="$emit('close')">
    <span slot="header">{{ t('deleteSession') }}</span>
    <span>{{ session ? t('deleteSessionDescription', { title: session.title }) : '' }}</span>
    <m3e-button slot="actions"><m3e-dialog-action @click="$emit('close')">{{ t('cancel') }}</m3e-dialog-action></m3e-button>
    <m3e-button slot="actions" class="danger-command"><m3e-dialog-action @click="$emit('confirm')">{{ t('delete') }}</m3e-dialog-action></m3e-button>
  </m3e-dialog>
</template>
