/*
 * UI 原语出口：页面只从这里拿按钮、输入框和 KIMA 组件。
 *
 * 业务页面不直接 import @kernel4632/kima；换组件库时只改这一层。
 * 调用示例：
 *   import { AppIcon, Button, Field, KimaSelect } from './index.js'
 */

export {
  KimaAlert, KimaButton, KimaCard, KimaCheckbox, KimaCheckboxGroup, KimaChip,
  KimaCodeBlock, KimaDialog, KimaDivider, KimaDrawer, KimaFlex, KimaIcon,
  KimaIconButton, KimaJsonInput, KimaList, KimaListbox, KimaMenu, KimaNotification,
  KimaNumberField, KimaPopover, KimaProgress, KimaRadioGroup, KimaRingProgress,
  KimaSelect, KimaSlider, KimaSpinner, KimaSwitch, KimaTabs, KimaTextField,
  KimaTextarea, KimaTypography,
} from '@kernel4632/kima'

export { default as AppIcon } from './AppIcon.vue'
export { default as Button } from './Button.vue'
export { default as ChoiceContent } from './ChoiceContent.vue'
export { default as Dialog } from './Dialog.vue'
export { default as Field } from './Field.vue'
export { default as IconButton } from './IconButton.vue'
export { default as KimaMarkdown } from './KimaMarkdown.vue'
export { default as MenuButton } from './MenuButton.vue'
export { default as ModelIcon } from './ModelIcon.vue'
export { default as Sheet } from './Sheet.vue'
export { default as SmoothMarkdown } from './SmoothMarkdown.vue'
export { default as Switch } from './Switch.vue'
export { avatarColor, initial } from './avatar.js'
