import { defineConfig } from '@vben/vite-config';
import { resolve } from 'path';

// 自行取消注释来启用按需导入功能
// import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers';
// import Components from 'unplugin-vue-components/vite';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      define: {
        // 注入项目根路径到运行时（ruoyi-admin目录层级）
        __PROJECT_ROOT__: JSON.stringify((() => {
          const cwd = process.cwd();
          console.log('Vite当前工作目录:', cwd);

          // 规范化路径分隔符，统一处理 Windows 和 macOS/Linux
          const normalizedPath = cwd.replace(/\\/g, '/');

          // 如果当前目录包含 /apps/web-antd，则向上两级到 ruoyi-admin
          if (normalizedPath.includes('/apps/web-antd')) {
            return resolve(cwd, '../..');
          }
          // 如果当前目录包含 /apps，则向上一级到 ruoyi-admin
          else if (normalizedPath.includes('/apps')) {
            return resolve(cwd, '..');
          }
          // 否则返回当前目录
          else {
            return cwd;
          }
        })()),
      },
      // 解决 jiti 构建问题
      optimizeDeps: {
        include: ['jiti'],
      },
      ssr: {
        noExternal: ['jiti'],
      },
      build: {
        commonjsOptions: {
          transformMixedEsModules: true,
        },
        rollupOptions: {
          external: [
            /node_modules\/jiti\//,
          ],
        },
        target: 'es2022',
      },
      plugins: [
        // Components({
        //   dirs: [], // 默认会导入src/components目录下所有组件 不需要
        //   dts: './types/components.d.ts', // 输出类型文件
        //   resolvers: [
        //     AntDesignVueResolver({
        //       // 需要排除Button组件 全局已经默认导入了
        //       exclude: ['Button'],
        //       importStyle: false, // css in js
        //     }),
        //   ],
        // }),
      ],
      server: {
        host: '127.0.0.1',
        port: 15666,
        strictPort: true,
        proxy: {
          // 2026-09-10 前缀分流修复（R29）：单 key + rewrite 分流，两类端点各归其位。
          // - /api/v1/**（IPD 契约）后端自带 /api/v1 前缀 → 原样转发；
          // - 其余 /api/**（平台端点 /workflow、/system 等）后端无 /api 前缀 → 剥离 /api。
          // 教训：此前「一律不吞 /api」只修了 IPD 半边，平台页面（我的文档/系统管理）全 404；
          // 上游默认「一律吞 /api」则 IPD 端点反向 404。必须按前缀分流，不可一刀切。
          '/api': {
            changeOrigin: true,
            rewrite: (path) =>
              path.startsWith('/api/v1') ? path : path.replace(/^\/api/, ''),
            target: 'http://127.0.0.1:16039',
            ws: true,
          },
        },
      },
      preview: {
        host: '127.0.0.1',
        port: 15666,
        strictPort: true,
      },
    },
  };
});
