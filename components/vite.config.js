/*
独立组件预览工程：只编译 components 目录里的静态 Vue 示例。
这里不代理 Agent Server，也不读取 frontend 的 Store；组件确认后再迁移到正式前端。
启动方式：bun run dev。
*/
import { defineConfig } from 'vite'                         // 引入 Vite 配置能力
import vue from '@vitejs/plugin-vue'                        // 编译 Vue 单文件组件

export default defineConfig({                               // 导出独立预览配置
  plugins: [vue()],                                         // 只启用 Vue 编译插件
  server: { port: 5180, strictPort: true },                 // 使用独立端口避免影响 frontend
})
