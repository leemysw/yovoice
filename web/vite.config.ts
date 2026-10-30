import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 模型目录、生成选项、AI 预设等数据只在 Go 的 internal/ 下保存一份，界面经 @internal 别名直接引用（tsconfig.json 的 paths 同步）。
const internalDir = fileURLToPath(new URL('../internal', import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { alias: { '@internal': internalDir } },
  server: { port: 5173, strictPort: true, fs: { allow: ['.', internalDir] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 稳定的 React 运行时独立缓存，业务改动无需重新加载这一部分。
        manualChunks: { react: ['react', 'react-dom', 'react-dom/client'] },
      },
    },
  },
});
