<!--
数据管理：作为设置分类内容区域，不虚构尚未设计的数据操作。
后续有明确的数据管理功能时，再在此区域加入对应触发入口。
调用示例：<DataSettings />
-->
<script setup>
import { t } from '../../i18n.js'                                      // 提供数据管理标题
</script>

<template>
  <section class="simple-settings data-settings">
    <header class="simple-settings__heading"><h3>{{ t('dataManagement') }}</h3></header>
  </section>
</template>
