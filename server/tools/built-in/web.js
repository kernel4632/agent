/*
网络工具集：通过标准 fetch 发起真实 HTTP GET 请求并返回响应正文。
权限由对话指令统一判断，本文件不持有会话或配置状态。
调用示例：await web_fetch.execute({ url: 'https://example.com' })。
*/

// --- 获取网页内容 ---
export const web_fetch = {                                      // 导出模型可调用的网络读取工具
  description: '获取公开 HTTP 或 HTTPS 地址的文本内容。',       // 明确工具只执行读取请求
  parameters: {                                                 // 定义模型生成参数的业务结构
    url: { type: 'string', description: '完整网页地址', required: true }, // 请求地址必须明确提供
  },
  async execute({ url }, context = {}) {
    const response = await fetch(url, { signal: context.abortSignal }) // 向目标地址发起可取消网络请求
    const content = await response.text()                        // 读取完整响应正文供模型分析
    return { result: content }                                   // 将网页文本反馈给模型
  },
}
