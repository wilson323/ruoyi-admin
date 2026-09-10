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
          // IPD contracts keep their /api/v1 prefix on the Java backend.
          '/api/v1': {
            changeOrigin: true,
            target: 'http://127.0.0.1:16039',
            ws: true,
          },
          '/api': {
            changeOrigin: true,
            // 整合仓修复保留（2026-09-10）：不吞 /api 前缀转发到 IPD 后端 16039，
            // 上游默认 rewrite 会吞 /api 导致后端 404「No endpoint POST /v1/...」
            // target: process.env.VITE_API_TARGET || 'http://127.0.0.1:16039',
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
