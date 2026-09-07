import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: [
      'apps/web-antd/src/packages/workflow-designer/properties/GenericNodeProperty.test.ts',
      'apps/web-antd/src/api/ipd/**/*.test.ts',
      'apps/web-antd/src/views/ipd/**/*.test.ts',
    ],
  },
});
