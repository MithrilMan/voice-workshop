import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5186, strictPort: true, // 5178 is the listening lab's
    // in a container on a Windows or macOS folder, file events do not cross the mount: poll instead
    // (never the scratch folder .ref, which git ignores: polling its thousands of files three times a second
    // keeps the server too busy to answer)
    watch: { ignored: ['**/.ref/**'], ...(process.env.VITE_POLL ? { usePolling: true, interval: 300 } : {}) },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
