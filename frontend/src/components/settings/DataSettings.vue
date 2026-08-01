<!-- 数据设置：保留数据管理入口，说明当前 Server 未提供数据操作。 -->
<script setup>
import { t } from '../../i18n.js'                                      // 提供数据管理状态文案
</script>

<template>
  <section class="simple-settings data-settings">
    <header class="simple-settings__heading"><div><h3>{{ t('dataManagement') }}</h3><p>{{ t('dataDescription') }}</p></div></header>
    <m3e-card><div class="data-setting-row"><m3e-avatar><m3e-icon name="storage"></m3e-icon></m3e-avatar><div><strong>{{ t('dataActionsUnavailable') }}</strong><small>{{ t('dataActionsUnavailableDescription') }}</small></div></div></m3e-card>
  </section>
</template>
