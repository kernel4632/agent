/*
 Vite 开发配置：编译 Vue 单文件组件、识别 M3E Web Components，并代理真实 Agent Server API。
代理地址可通过 AGENT_SERVER_URL 覆盖，默认连接 README 规定的 127.0.0.1:4632。
调用示例：AGENT_SERVER_URL=http://127.0.0.1:4633 bun run dev。
*/
import { defineConfig } from 'vite'                 // 引入 Vite 配置声明能力
import vue from '@vitejs/plugin-vue'                // 引入 Vue 单文件组件编译能力

const serverURL = process.env.AGENT_SERVER_URL ?? 'http://127.0.0.1:4632' // 读取当前开发 Server 地址

function openAIProxy() {
  async function handle(request, response, next) {
    const requestURL = new URL(request.url, 'http://127.0.0.1')
    if (requestURL.pathname !== '/openai-proxy/models') return next()
    response.setHeader('access-control-allow-origin', '*')
    try {
      const baseURL = new URL(requestURL.searchParams.get('baseURL'))
      if (!['http:', 'https:'].includes(baseURL.protocol)) throw new Error('仅支持 HTTP 或 HTTPS API 地址')
      const target = new URL(`${baseURL.href.replace(/\/+$/, '')}/models`)
      const upstream = await fetch(target, {
        headers: {
          accept: 'application/json',
          ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        },
      })
      response.statusCode = upstream.status
      response.setHeader('content-type', upstream.headers.get('content-type') || 'application/json')
      response.end(Buffer.from(await upstream.arrayBuffer()))
    } catch (error) {
      response.statusCode = 502
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ error: error.message }))
    }
  }

  return {
    name: 'openai-model-proxy',
    configureServer(server) { server.middlewares.use(handle) },
    configurePreviewServer(server) { server.middlewares.use(handle) },
  }
}

export default defineConfig({                       // 导出前端开发与构建配置
  plugins: [                                        // 注册项目需要的编译插件
    vue({                                           // 编译 Vue 3 单文件组件
      template: {                                   // 配置模板标签识别规则
        compilerOptions: {                          // 将 M3E 交给浏览器自定义元素处理
          isCustomElement: (tag) => tag.startsWith('m3e-'), // 所有 m3e-* 标签均不是 Vue 组件
        },
      },
    }),
    openAIProxy(),                                  // 本地同源代理任意 OpenAI 兼容模型目录
  ],
  css: {                                            // 配置 CSS 预处理
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/mixins" as *;\n`, // 全部 SCSS 文件自动注入 mixin，无需手动 @use
      },
    },
  },
  resolve: {                                        // 配置模块解析
    alias: { '@': '/src' },                         // @ 别名指向 src 目录
  },
  server: {                                         // 配置本地开发服务
    port: 5173,                                     // 使用 Vite 常见开发端口
    strictPort: false,                              // 被占用时自动选择下一个可用端口
    proxy: {                                        // 将浏览器 API 请求转发到 Agent Server
      '/api': {                                     // 前端统一使用 /api 前缀避免跨域
        target: serverURL,                          // 转发到当前真实 Agent Server
        changeOrigin: true,                         // 使用目标主机头兼容本地服务
        rewrite: (path) => path.replace(/^\/api/, ''), // Server 路由本身不包含 /api
      },
    },
  },
})
