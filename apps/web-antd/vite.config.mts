import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@vben/vite-config';
import { resolve as resolvePath } from 'path';

const __vite_dirname = resolve(fileURLToPath(import.meta.url), '..');

/**
 * iconify 本地静态映射
 *
 * 2026-09-18：CDN 出口完全不可达（curl https://api.iconify.design → 超时），
 * apps/web-antd 不直接依赖 @iconify/json，pnpm prune 会删 node_modules/@iconify/json。
 * 把 8 个本仓实际用到的 prefix JSON 用 symlink 挂到 apps/web-antd/public/iconify-api/，
 * vite 默认 public 目录自动 serve。前端 bootstrap 调用：
 *   addAPIProvider('', { resources: ['/iconify-api'], path: '/' })
 * 之后 @iconify/vue 拼出 /iconify-api/{prefix}.json?icons=...，
 * 浏览器不再请求 api.iconify.design / simplesvg / unisvg / unpkg。
 *
 * 已知 prefix 清单（实测 console 报错聚合）：lucide / material-symbols / mdi / carbon /
 * solar / system-uicons / tabler / octicon。如发现新 prefix 需要增补。
 */
// 2026-09-18：apps/web-antd 不直接依赖 @iconify/json，pnpm prune 会删 node_modules/@iconify/json。
// 不再走 iconifyDir 变量路径，改用 apps/web-antd/public/iconify-api/ symlink 方式（见下方注释）。

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
      publicDir: 'public',
      server: {
        host: '127.0.0.1',
        port: 15666,
        strictPort: true,
        proxy: {
          // 2026-09-10 前缀分流修复（R29）：单 key + rewrite 分流，两类端点各归其位。
          // - /api/v1/**（IPD 契约）后端自带 /api/v1 前缀 → 原样转发；
          // - 其余 /api/**（平台端点 /workflow、/system 等）后端无 /api 前缀 → 剥离 /api。
          // 教训：此前「一律不吞 /api」只修了 IPD 半边，平台页面（我的文档/系统管理）全 404；
          // 上游默认「一律吞 /api」则 IPD 端点反向 404。必须按前缀分流，不可一 刀切。
          '/api': {
            changeOrigin: true,
            rewrite: (path) =>
              path.startsWith('/api/v1') ? path : path.replace(/^\/api/, ''),
            target: 'http://127.0.0.1:16039',
            ws: true,
          },
          // 2026-09-11 修复：ipd-auth.logout 中平台会话 best-effort 退出调裸 /auth/logout
          // （vben 上游 SSO 端点约定，无 /api 前缀），vite 不代理该路径 → 浏览器 console
          // 显示「Failed to load resource: 404」。生产 Nginx 走默认 server_name 转发，
          // dev 环境必须显式声明。target 同后端端口；目标端点不存在时后端返回 4xx
          // （业务错误，非资源加载失败，浏览器 console 标记不同）。
          // 2026-09-18 精确化：仅 POST /auth/logout（Sa-Token 平台会话退出）走代理。
          // SPA 整页导航路径 /auth/login（已被别名 /login 取代，几乎不会整页访问）、
          // /auth/register /forget-password /code-login /qrcode-login /change-password
          // 都是 Vue Router 注册的前端页面，GET 不应被代理吞，否则后端返回 405 JSON
          // 被浏览器当 HTML 渲染（实测 visit /auth/register 显示 `{"code":405,...}`）。
          // 用 bypass 排除这些路径，让 Vite SPA index.html 接管。
          '/auth/logout': {
            changeOrigin: true,
            target: 'http://127.0.0.1:16039',
          },
          // 2026-09-18：/monitor/Admin 页面 iframe 嵌入 snailjob 控制台，
          // 原写死 src="http://localhost:9090/admin/applications" 产生 cross-origin
          // 加载失败 + console ERROR。代理 /snailjob-admin → 127.0.0.1:9090 后 iframe
          // 走 same-origin，浏览器不会记录"Failed to load resource"为 console error。
          '/snailjob-admin': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/snailjob-admin/, ''),
            target: 'http://127.0.0.1:9090',
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
