/*
头像工具：同一段文字（工作区 id、标签 key 等）永远得到同一种颜色，并取首字母作为头像文字。
调用示例：avatarColor(workspace.id)、initial(workspace.name)。
*/
const palette = ['#3250df', '#2eaf5a', '#ee7330', '#e4429e', '#623be2', '#0096b8']

const hash = value => {
  let number = 0
  for (const char of String(value)) number = (number * 31 + char.charCodeAt(0)) >>> 0
  return number
}

export const avatarColor = value => palette[hash(value) % palette.length]
export const initial = value => (value || '?').trim().slice(0, 1).toUpperCase()
