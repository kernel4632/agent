/*
Web 工具：通过标准 fetch 获取公开 HTTP 或 HTTPS 文本。
请求直接使用会话 AbortSignal，用户停止时同步中断网络读取。
调用示例：await webTool.execute({ url: 'https://example.com' }, context)。
*/

// --- 获取网页文本 ---
export const webTool = {
  name: 'web',                                          // LLM 调用使用的稳定工具名
  description: '获取公开 HTTP 或 HTTPS 地址的文本内容。', // 明确工具执行只读网络请求
  inputSchema: {
    type: 'object',                                     // 工具输入必须是对象
    properties: {
      url: { type: 'string', format: 'uri', description: '完整网页地址' }, // 请求必须提供完整 URL
    },
    required: ['url'],                                  // URL 不能为空
    additionalProperties: false,                       // 拒绝无意义参数
  },
  async execute({ url }, context) {
    const response = await fetch(url, { signal: context.abortSignal }) // 发起可取消网络请求
    if (!response.ok) throw Object.assign(new Error(`web request failed with status ${response.status}`), { status: response.status }) // 非成功响应转为工具错误
    return { output: await response.text() }            // 返回完整响应文本
  },
}
