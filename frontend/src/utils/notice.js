/* 操作反馈：保存一条应用提示；界面通过 store.ui.toast 显示。
 * 消息可以是字符串，也可以是 { message, action: { label, run } }——
 * 带 action 时提示条里出现一个按钮，点击执行 run 并关闭提示。
 * 调用：Notice.show('已保存')；Notice.clear()。
 */
import { store } from '../store.js'

/** 显示最近一次操作结果；显示时长由 Toast 的局部生命周期负责。 */
function show(message) {
  store.ui.toast = typeof message === 'object' && message !== null ? message : String(message ?? '') // 覆盖上一条提示，不再另开第二个计时器
}

/** 用户关闭或提示到时后清空。 */
function clear() {
  store.ui.toast = '' // 组件据此播放退出动画
}

export const Notice = { show, clear }
