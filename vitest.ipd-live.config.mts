import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    environmentOptions: { happyDOM: { url: 'http://127.0.0.1:15666' } },
    include: ['apps/web-antd/src/views/ipd/auth/auth-live.test.ts'],
    testTimeout: process.env.IPD_LIVE_ACCEPTANCE === 'market-900103-natural-expiry' ? 1_000_000 : 20_000,
  },
});
