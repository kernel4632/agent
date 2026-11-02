/* 操作反馈：保存一条应用提示；界面通过 store.ui.toast 显示。
 * 调用：Notice.show('已保存')；Notice.clear()。
 */
import { store } from '../store.js'

/** 显示最近一次操作结果；显示时长由 Toast 的局部生命周期负责。 */
function show(message) {
  store.ui.toast = message // 覆盖上一条提示，不再另开第二个计时器
}

/** 用户关闭或提示到时后清空。 */
function clear() {
  store.ui.toast = '' // 组件据此播放退出动画
}

export const Notice = { show, clear }
