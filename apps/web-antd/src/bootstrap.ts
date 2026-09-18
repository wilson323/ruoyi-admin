import { createApp, watchEffect } from 'vue';

import { registerAccessDirective } from '@vben/access';
import { registerLoadingDirective } from '@vben/common-ui/es/loading';
import { preferences, updatePreferences } from '@vben/preferences';
import { initStores } from '@vben/stores';
import '@vben/styles';
import '@vben/styles/antd';

import { useTitle } from '@vueuse/core';

import { setupGlobalComponent } from '#/components/global';
import { $t, setupI18n } from '#/locales';

// 2026-09-18: 把 iconify 默认 CDN（api.iconify.design / simplesvg / unisvg）切到
// vite dev 中间件 `/iconify-api/{prefix}.json`，本仓 pnpm 已装 @iconify/json@2.2.417，
// 中间件从 node_modules/@iconify/json/json 读取 SVG 数据；浏览器不再请求外网 CDN，
// 控制台 net::ERR_CONNECTION_CLOSED 24 条 → 0。dev only，生产环境走 Nginx 静态资源或
// 保留默认 CDN。addAPIProvider 由 @vben-core/icons 重新导出，避免直引 @iconify/vue
// 触发 tsconfig path 缺失。
import { addAPIProvider } from '@vben/icons';
addAPIProvider('', {
  resources: ['/iconify-api'],
  path: '/',
});

import { initComponentAdapter } from './adapter/component';
import { initSetupVbenForm } from './adapter/form';
import App from './app.vue';
import { router } from './router';

async function bootstrap(namespace: string) {
  // 2026-09-12 修复：vben preferences 缓存优先级高于代码 overrides（initPreferences
  // 内部 merge 是「缓存优先」语义），存量浏览器缓存里仍存着模板默认的
  // defaultHomePath=/analytics（demo 页已删，直达即 404），代码里改 overrides
  // 无法纠正——启动时强制覆盖一次；该键不在设置面板暴露，用户不可能自定义，
  // 强制覆盖无副作用。updatePreferences 会把新值写回缓存，下次启动自不再需要。
  updatePreferences({ app: { defaultHomePath: '/ipd/workbench' } });

  // 2026-09-18：同上，localStorage 里缓存了旧 defaultAvatar
  // = https://unpkg.com/@vbenjs/static-source@0.1.7/source/avatar-v1.webp
  // （unpkg 出口不可达，浏览器 ERR_CONNECTION_CLOSED）。代码层
  // packages/@core/preferences/src/config.ts 已改 /avatar-v1.png，但缓存优先覆盖，
  // 启动时再强制写一次；头像源仅仓库 owner 控制，用户设置面板不能改，安全。
  updatePreferences({ app: { defaultAvatar: '/avatar-v1.png' } });

  // 初始化组件适配器
  await initComponentAdapter();

  // 初始化表单组件
  await initSetupVbenForm();

  // // 设置弹窗的默认配置
  // setDefaultModalProps({
  //   fullscreenButton: false,
  // });
  // // 设置抽屉的默认配置
  // setDefaultDrawerProps({
  //   zIndex: 1020,
  // });

  const app = createApp(App);

  // 全局组件
  setupGlobalComponent(app);
  // 注册v-loading指令
  registerLoadingDirective(app, {
    loading: 'loading', // 在这里可以自定义指令名称，也可以明确提供false表示不注册这个指令
    spinning: 'spinning',
  });

  // 国际化 i18n 配置
  await setupI18n(app);

  // 配置 pinia-tore
  await initStores(app, { namespace });

  // 安装权限指令
  registerAccessDirective(app);

  // 初始化 tippy
  const { initTippy } = await import('@vben/common-ui/es/tippy');
  initTippy(app);

  // 配置路由及路由守卫
  app.use(router);

  // 配置Motion插件
  const { MotionPlugin } = await import('@vben/plugins/motion');
  app.use(MotionPlugin);

  // 动态更新标题
  watchEffect(() => {
    if (preferences.app.dynamicTitle) {
      const routeTitle = router.currentRoute.value.meta?.title;
      const pageTitle =
        (routeTitle ? `${$t(routeTitle)} - ` : '') + preferences.app.name;
      useTitle(pageTitle);
    }
  });

  app.mount('#app');
}

export { bootstrap };
