import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 部署在 /shuati/ 子路径，通过 VITE_BASE 注入。
  base: process.env.VITE_BASE ?? '/',
});
