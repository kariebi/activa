import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    react: 'src/react.ts',
    hono: 'src/hono.ts',
    node: 'src/node.ts',
    testing: 'src/testing.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022'
});
