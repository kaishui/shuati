import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 部署在 /shuati/ 子路径，通过 VITE_BASE 注入。
  base: process.env.VITE_BASE ?? '/',
  server: {
    port: 5173,
    // 开发环境下把 /api 代理到后端，避免跨域。
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
});
