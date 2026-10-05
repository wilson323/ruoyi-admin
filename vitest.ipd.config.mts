import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    // R234 超时预算（异常根除·机制化）：默认 5000ms 在多会话并发负载下必出假红——
    // 实测单测基线 2-4s，兄弟会话并行 mvn/vitest/构建时 2-3x 放大（两轮全量 57→12 failed
    // 波动、10 个超时全部落在 5.1-8.5s 无一 >10s，纯负载敏感 flake）。
    // 15s = 基线 4s × ~3.5x 负载放大 + 余量；真死锁/真挂起到 15s 照样红，不掩盖缺陷。
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: [
      'apps/web-antd/src/utils/file/base64Conver.test.ts',
      'apps/web-antd/src/components/cropper/src/cropper-modal.test.ts',
      'apps/web-antd/src/components/upload/src/hook.test.ts',
      'apps/web-antd/src/components/tree/src/menu-select-table.test.ts',
      'apps/web-antd/src/views/_core/social-callback/index.test.ts',
      'apps/web-antd/src/views/_core/profile/profile-panel.test.ts',
      // 2026-10-05 清理：删除两条命中 0 文件的死引用——
      //   apps/web-antd/src/packages/workflow-designer/properties/GenericNodeProperty.test.ts
      //   apps/web-antd/src/views/workflow/**/*.test.ts
      // 两者指向的目录在仓库里已不存在。将来若重建这些目录并补测试，必须把条目加回本清单，
      // 否则测试不会被执行（vitest 只跑 include 命中的文件，不会自动发现）。
      'apps/web-antd/src/api/ipd/**/*.test.ts',
      'apps/web-antd/src/router/ipd-guard.test.ts',
      'apps/web-antd/src/store/**/*.test.ts',
      'apps/web-antd/src/views/ipd/**/*.test.ts',
      // Track E（MCP 与 Skill 配置中心）：存量页改造补测（E5-⑥ 白名单扩展）
      'apps/web-antd/src/views/mcp/**/*.test.ts',
      'apps/web-antd/src/views/agent/agent/**/*.test.ts',
      // api/mcp 现有 4 个活源文件（market/index.ts、tool/index.ts）但尚无测试；
      // 该条目是前瞻性的，不是死引用——删掉会让将来的 MCP 接口测试静默不跑，故保留。
      'apps/web-antd/src/api/mcp/**/*.test.ts',
    ],
    setupFiles: ['./vitest.ipd.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/ipd',
      include: [
        'apps/web-antd/src/api/ipd/**/*.{ts,vue}',
        'apps/web-antd/src/router/ipd-guard.ts',
        'apps/web-antd/src/views/ipd/**/*.{ts,vue}',
        // Track E（E5-⑥ 白名单扩展）
        'apps/web-antd/src/views/mcp/**/*.{ts,vue}',
        'apps/web-antd/src/views/agent/agent/**/*.{ts,vue}',
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
