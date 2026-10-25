/*
 * 文本附件：草稿页和会话页共用同一套大小、类型检查和读取逻辑。
 * 只接受纯文本/代码，图片和二进制文件需要模型支持视觉能力，当前先不放进附件列表。
 * 调用示例：
 *   const { files, errors } = await readAttachments(input.files)
 *   errors.forEach(UI.notify)
 */
export const MAX_ATTACHMENT_SIZE = 1024 * 1024        // 1 MiB：再大就会把上下文一次撑爆
export const ATTACHMENT_EXTENSIONS = ['txt', 'md', 'js', 'jsx', 'ts', 'tsx', 'json', 'css', 'scss', 'html', 'vue', 'py', 'go', 'rs', 'yaml', 'yml', 'csv', 'xml', 'sh', 'log']
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map(extension => `.${extension}`).join(',')
const ATTACHMENT_PATTERN = new RegExp(`\\.(${ATTACHMENT_EXTENSIONS.join('|')})$`, 'i')

// 返回空字符串表示可以附加；否则是直接给用户看的原因。
export function attachmentError(file) {
  if (file.size > MAX_ATTACHMENT_SIZE) return `${file.name} 超过 1 MiB`
  if (!ATTACHMENT_PATTERN.test(file.name)) return '当前支持文本与代码附件，不支持图片或二进制文件'
  return ''
}

// 先检查再读取；有错的文件不读，避免为一个二进制文件浪费时间。
export async function readAttachments(files) {
  const accepted = []
  const errors = []
  for (const file of files) {
    const error = attachmentError(file)                   // 大小和扩展名一起检查
    if (error) { errors.push(error); continue }           // 失败的文件不读取内容
    accepted.push({ id: crypto.randomUUID(), name: file.name, content: await file.text() }) // 只保存文本内容
  }
  return { files: accepted, errors }                       // 调用方统一提示错误
}
