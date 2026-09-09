import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: [
      'apps/web-antd/src/packages/workflow-designer/properties/GenericNodeProperty.test.ts',
      'apps/web-antd/src/api/ipd/**/*.test.ts',
      'apps/web-antd/src/store/**/*.test.ts',
      'apps/web-antd/src/views/ipd/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/ipd',
      include: [
        'apps/web-antd/src/api/ipd/**/*.{ts,vue}',
        'apps/web-antd/src/views/ipd/**/*.{ts,vue}',
      ],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.config.{ts,mts,js,mjs}',
        '**/types/**',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
