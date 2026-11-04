/*
 * 图片能力提示：粘贴图片时按当前模型的 capabilities.image 决定怎么提醒。
 * 提示只在粘贴那一刻弹，不影响粘贴和发送本身；图片照常进附件列表和 history。
 * 模型没开图片输入时，Toast 里带一个「打开图片输入」按钮，点了直接写配置再确认。
 * 调用示例：
 *   imagePasteNotice({ hasImage, provider, model })       // 粘贴图片后调用
 *   hasImageCapability(provider, model)                    // true 表示当前模型能看图
 */
import { AgentAPI } from '../utils/api.js'
import { store } from '../store.js'
import { Notice } from './notice.js'
import { Settings } from './settings.js'

// --- 这台模型配置里有没有开图片输入 ---
export function hasImageCapability(provider, model) {
  const config = store.config.providers[provider]
  const entry = (config?.models || []).find(item => item.id === model)
  return Boolean(entry?.capabilities?.includes('image'))
}

// --- 直接给这台模型补上 image 能力并保存配置 ---
// 设置草稿已打开时改草稿并 autoSave；否则用 open() 建出同一份草稿再改，不碰用户正在编辑的界面状态。
async function enableImage(provider, model) {
  if (!store.settings.draft) Settings.open()
  const draft = store.settings.draft
  const entry = (draft.providers || []).find(item => item.name === provider)
  if (!entry) { Notice.show('找不到这个供应商的配置'); return false }
  const modelEntry = (entry.models || []).find(item => item.id === model)
  if (!modelEntry) { Notice.show('找不到这个模型的配置'); return false }
  if (Array.isArray(modelEntry.capabilities)) {
    if (!modelEntry.capabilities.includes('image')) modelEntry.capabilities.push('image')
  } else {
    modelEntry.capabilities = ['text', 'image']
  }
  await Settings.autoSave()
  return true
}

/**
 * 粘贴图片后按当前模型能力提醒一次。
 * 有能力就不打扰；没能力弹一条带按钮的提示，不影响粘贴本身。
 */
export function imagePasteNotice({ hasImage, provider, model }) {
  if (!hasImage) return
  if (hasImageCapability(provider, model)) return
  Notice.show({
    message: `${model} 没有开启图片输入，模型看不到这张图。确认它有多模态能力的话，`,
    action: { label: '打开图片输入', run: async () => {
      const done = await enableImage(provider, model)
      Notice.show(done ? `已为 ${model} 打开图片输入，下一轮请求生效` : '没能打开图片输入，请到设置里手动开启')
    } },
  })
}
