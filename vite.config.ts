import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  build: { target: 'es2022', rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], markdown: ['marked', 'dompurify', 'yaml'], syntax: ['highlight.js/lib/common'] } } } },
});
