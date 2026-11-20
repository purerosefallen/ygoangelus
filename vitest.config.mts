import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: {
    decorator: {
      legacy: true,
      emitDecoratorMetadata: true,
    },
    assumptions: {
      setPublicClassFields: true,
    },
    typescript: {
      removeClassFieldsWithoutInitializer: true,
    },
  },
  test: {
    globals: true,
    fileParallelism: false,
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['reflect-metadata'],
  },
});
