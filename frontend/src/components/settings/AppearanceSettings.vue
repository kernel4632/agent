<!-- 外观设置：展示语言、密度和动画开关，并发出字段变化。 -->
<script setup>
import { t } from '../../i18n.js'                                      // 提供外观配置文案
import SelectField from '../shared/SelectField.vue'                   // 使用 M3E 选择字段
defineProps({ appearance: { type: Object, required: true } })
defineEmits(['update'])                                                // 将外观字段变化交回 Command
const languageOptions = [{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }]
</script>

<template>
  <section class="simple-settings">
    <header class="simple-settings__heading"><div><h3>{{ t('appearance') }}</h3><p>{{ t('appearanceDescription') }}</p></div></header>
    <SelectField :model-value="appearance.language" :options="languageOptions" :label="t('interfaceLanguage')" @change="$emit('update', 'language', $event)" />
    <SelectField :model-value="appearance.density" :options="[{ value: 'comfortable', label: t('comfortable') }, { value: 'compact', label: t('compact') }]" :label="t('interfaceDensity')" @change="$emit('update', 'density', $event)" />
    <label class="switch-field"><span><strong>{{ t('animations') }}</strong><small>{{ t('animationsDescription') }}</small></span><m3e-switch :checked="appearance.animations" @change="$emit('update', 'animations', $event.target.checked)"></m3e-switch></label>
  </section>
</template>
