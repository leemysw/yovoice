import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 模型目录、生成选项、AI 预设等数据只在 Go 的 internal/ 下保存一份，界面经 @internal 别名直接引用（tsconfig.json 的 paths 同步）。
const internalDir = fileURLToPath(new URL('../internal', import.meta.url));

// Astryx 语言包里的 description 是给译者看的说明，运行时不读取；构建时剥掉，每个语言分块约小一半。
function stripLocaleDescriptions(): Plugin {
  return {
    name: 'yovoice:strip-locale-descriptions',
    enforce: 'pre',
    transform(code, id) {
      if (!/@astryxdesign\/core\/locales\/[^/]+\.json$/.test(id)) return;
      const catalog = JSON.parse(code) as Record<string, { defaultMessage: string; description?: string }>;
      for (const entry of Object.values(catalog)) delete entry.description;
      return { code: JSON.stringify(catalog), map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), stripLocaleDescriptions()],
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
