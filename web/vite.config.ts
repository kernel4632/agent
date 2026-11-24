// 开发服务器：/api 转给后端（后端重写后的地址），加 ?demo 时完全不连后端，用本地回放。
// ?ext= 开发模式的加载器只在 dev 下可达；生产构建 main.ts 走空实现，扩展源码不进产物。
// 扩展前端从 extensions/ import 时，裸包名在这里解析回 web 自己的依赖。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  build: { target: 'es2022' },
  resolve: {
    alias: {
      '@hugeicons/core-free-icons': resolve('node_modules/@hugeicons/core-free-icons'),
    },
  },
  server: { port: 5180, proxy: { '/api': 'http://127.0.0.1:3000' } },
})
