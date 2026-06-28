import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [dts({ include: ['src'], rollupTypes: true })],
  build: {
    target: 'es2018',
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['socket.io-client', 'engine.io-client', 'engine.io-parser'],
    },
    minify: false,
    sourcemap: true,
  },
})
