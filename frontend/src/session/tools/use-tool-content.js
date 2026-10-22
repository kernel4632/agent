import { computed } from 'vue'
import { outputText, outputValue } from '../tool-ui.js'

/**
 * 工具结果视图共用的输入/输出读取逻辑。
 * 不把 output 的 AI SDK 包装格式泄漏到每个视图里。
 */
export function useToolContent(props) {
    const input = computed(() => props.tool?.input || {})
    const value = computed(() => outputValue(props.tool))
    const text = computed(() => outputText(props.tool))
    return { input, value, text }
}

export const clip = (value, limit = 2400) => {
    const content = String(value ?? '')
    return content.length > limit ? `${content.slice(0, limit)}\n…` : content
}
