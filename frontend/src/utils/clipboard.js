/* 浏览器剪贴板：复制成功或失败由调用者决定怎样反馈。
 * 调用：const copied = await copyText(text)。
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text) // 浏览器权限在实际操作时校验
    return true
  } catch {
    return false // 写入失败让界面保留内容并提示
  }
}
