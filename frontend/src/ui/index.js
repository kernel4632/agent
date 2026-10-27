/*
 * UI 原语出口：页面只从这里拿 Button、Field、Icon 等基础组件。
 *
 * 这些文件大多是 KIMA 组件的轻包装；选择框直接用 KIMA 的 KimaSelect，不再包装。
 * 调用示例：
 *   import { AppIcon, Button, Field } from './index.js'
 */

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
