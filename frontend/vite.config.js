/*
 Vite 开发配置：编译 Vue 单文件组件、识别 M3E Web Components，并代理真实 Agent Server API。
代理地址可通过 AGENT_SERVER_URL 覆盖，默认连接 README 规定的 127.0.0.1:4632。
调用示例：AGENT_SERVER_URL=http://127.0.0.1:4633 bun run dev。
*/
import { defineConfig } from 'vite'                 // 引入 Vite 配置声明能力
import vue from '@vitejs/plugin-vue'                // 引入 Vue 单文件组件编译能力

const serverURL = process.env.AGENT_SERVER_URL ?? 'http://127.0.0.1:4632' // 读取当前开发 Server 地址

export default defineConfig({                       // 导出前端开发与构建配置
  plugins: [                                        // 注册项目需要的编译插件
    vue({                                           // 编译 Vue 3 单文件组件
      template: {                                   // 配置模板标签识别规则
        compilerOptions: {                          // 将 M3E 交给浏览器自定义元素处理
          isCustomElement: (tag) => tag.startsWith('m3e-'), // 所有 m3e-* 标签均不是 Vue 组件
        },
      },
    }),
  ],
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
