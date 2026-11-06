/*
 * 附件：草稿页和会话页共用同一套大小、类型检查和读取逻辑。
 * 文本/代码附件存 content，图片附件存 dataUrl（base64）；
 * 发送时文本拼进输入串，图片变成内容块数组随消息进 history 常驻。
 * 图片能不能发给模型由所选模型的 capabilities.image 决定，提示逻辑在 commands/chat.js。
 * 调用示例：
 *   const { files, errors } = await readAttachments(input.files)
 *   errors.forEach(Notice.show)
 */
export const MAX_ATTACHMENT_SIZE = 1024 * 1024        // 1 MiB：再大就会把上下文一次撑爆
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024         // 5 MiB：base64 后约 6.7M 字符，服务端上限 8M
export const ATTACHMENT_EXTENSIONS = ['txt', 'md', 'js', 'jsx', 'ts', 'tsx', 'json', 'css', 'scss', 'html', 'vue', 'py', 'go', 'rs', 'yaml', 'yml', 'csv', 'xml', 'sh', 'log']
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const ATTACHMENT_ACCEPT = [...ATTACHMENT_EXTENSIONS.map(extension => `.${extension}`), ...IMAGE_TYPES].join(',')
export const ATTACHMENT_PATTERN = new RegExp(`\\.(${ATTACHMENT_EXTENSIONS.join('|')})$`, 'i')

// 返回空字符串表示可以附加；否则是直接给用户看的原因。
export function attachmentError(file) {
  if (file.type.startsWith('image/')) {
    if (!IMAGE_TYPES.includes(file.type)) return `${file.name} 不是支持的图片格式（PNG / JPEG / GIF / WebP）`
    if (file.size > MAX_IMAGE_SIZE) return `${file.name} 超过 5 MiB`
    return ''
  }
  if (file.size > MAX_ATTACHMENT_SIZE) return `${file.name} 超过 1 MiB`
  if (!ATTACHMENT_PATTERN.test(file.name)) return '当前支持文本、代码和图片附件'
  return ''
}

function readImage(file) {
  // 浏览器用 FileReader；测试环境（node --test）没有它，直接从 File 的数组缓冲自己拼 data URL。
  if (typeof FileReader === 'undefined') {
    return file.arrayBuffer().then(buffer => {
      let binary = ''
      for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
      return `data:${file.type};base64,${btoa(binary)}`
    })
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)          // data:image/...;base64,...
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`))
    reader.readAsDataURL(file)
  })
}

// 先检查再读取；有错的文件不读，避免为一个坏文件浪费时间。
export async function readAttachments(files) {
  const accepted = []
  const errors = []
  for (const file of files) {
    const error = attachmentError(file)                   // 大小和类型一起检查
    if (error) { errors.push(error); continue }           // 失败的文件不读取内容
    if (file.type.startsWith('image/')) {
      const dataUrl = await readImage(file)
      accepted.push({ id: crypto.randomUUID(), name: file.name || '粘贴的图片.png', kind: 'image', dataUrl })
    } else {
      accepted.push({ id: crypto.randomUUID(), name: file.name, content: await file.text() }) // 只保存文本内容
    }
  }
  return { files: accepted, errors }                       // 调用方统一提示错误
}
