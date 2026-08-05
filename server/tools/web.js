/*
Web 工具：获取公开网页内容，支持纯文本和 Markdown 两种格式。
Markdown 模式用 turndown 把 HTML 转成结构化文本，对模型理解网页内容更友好。
调用示例：await webTool.execute({ url: 'https://example.com', format: 'markdown' }, signal)。
*/
import createError from 'http-errors'                   // 引入标准 HTTP 错误创建
import TurndownService from 'turndown'                  // 引入 HTML→Markdown 转换


const turndown = new TurndownService({                  // 全局共用转换器实例
  headingStyle: 'atx',                                  // 用 # 号表示标题
  codeBlockStyle: 'fenced',                             // 用 ``` 表示代码块
})


// --- 获取网页内容 ---
export const webTool = {
  name: 'web',
  description: '获取公开 HTTP/HTTPS 地址的内容。format 为 markdown 时自动把 HTML 转成 Markdown，更利于阅读和分析。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri', description: '完整网页地址' },
      format: { type: 'string', enum: ['text', 'markdown'], description: '输出格式：text 返回纯文本，markdown 返回 Markdown（默认 markdown）', default: 'markdown' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async execute({ url, format = 'markdown' }, signal) {
    const response = await fetch(url, { signal })
    if (!response.ok) throw createError(response.status, `web request failed with status ${response.status}`)
    const html = await response.text()

    if (format === 'text') {
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return { output: text }
    }

    return { output: turndown.turndown(html) }          // HTML→Markdown 转换
  },
}

export default webTool
