// 开发服务器：/api 转给后端（后端重写后的地址），加 ?demo 时完全不连后端，用本地回放。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: { target: 'es2022' },
  server: { port: 5180, proxy: { '/api': 'http://127.0.0.1:3000' } },
})
