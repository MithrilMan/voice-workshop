import { defineConfig } from 'vite';

/** The voices without the interface, as one ES module (src/library): npm run build:lib, into dist-lib/. */
export default defineConfig({
  publicDir: false,
  build: {
    target: 'es2022', outDir: 'dist-lib', emptyOutDir: true, sourcemap: true,
    lib: { entry: 'src/library/index.ts', formats: ['es'], fileName: 'voice-workshop' },
  },
});
