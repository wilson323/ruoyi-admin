import type { RouteRecordRaw } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';

import { $t } from '#/locales';

const BasicLayout = () => import('#/layouts/basic.vue');
const AuthPageLayout = () => import('#/layouts/auth.vue');
/** 全局404页面 */
const fallbackNotFoundRoute: RouteRecordRaw = {
  component: () => import('#/views/_core/fallback/not-found.vue'),
  meta: {
    hideInBreadcrumb: true,
    hideInMenu: true,
    hideInTab: true,
    title: '404',
  },
  name: 'FallbackNotFound',
  path: '/:path(.*)*',
};

/** 基本路由，这些路由是必须存在的 */
const coreRoutes: RouteRecordRaw[] = [
  /**
   * 根路由
   * 使用基础布局，作为所有页面的父级容器，子级就不必配置BasicLayout。
   * 此路由必须存在，且不应修改
   */
  {
    component: BasicLayout,
    meta: {
      hideInBreadcrumb: true,
      title: 'Root',
    },
    name: 'Root',
    path: '/',
    redirect: '/ipd/workbench',
    children: [],
  },
  {
    component: () => import('#/views/_core/social-callback/index.vue'),
    meta: {
      title: $t('page.auth.oauthLogin'),
    },
    name: 'OAuthRedirect',
    path: '/social-callback',
  },
  /** IPD 登录页：全屏复刻 ZK-IPD 原型双栏布局（治理/ZK-IPD一致性红线 S1），
   * 不套 AuthPageLayout，避免与原型双栏结构打架。 */
  {
    name: 'Login',
    path: '/auth/login',
    alias: '/login',
    component: () => import('#/views/ipd/auth/login.vue'),
    meta: {
      hideInTab: true,
      title: $t('page.auth.login'),
    },
  },
  {
    component: AuthPageLayout,
    meta: {
      hideInTab: true,
      title: 'Authentication',
    },
    name: 'Authentication',
    path: '/auth',
    redirect: LOGIN_PATH,
    children: [
      {
        name: 'IpdChangePassword',
        path: 'change-password',
        component: () => import('#/views/ipd/auth/change-password.vue'),
        meta: { title: '首次登录安全设置', hideInTab: true },
      },
      {
        name: 'IpdAccount',
        path: '/ipd/account',
        component: () => import('#/views/ipd/auth/account.vue'),
        meta: { title: '我的账户', hideInTab: true },
      },
      {
        name: 'CodeLogin',
        path: 'code-login',
        component: () => import('#/views/_core/authentication/code-login.vue'),
        meta: {
          title: $t('page.auth.codeLogin'),
        },
      },
      {
        name: 'QrCodeLogin',
        path: 'qrcode-login',
        component: () =>
          import('#/views/_core/authentication/qrcode-login.vue'),
        meta: {
          title: $t('page.auth.qrcodeLogin'),
        },
      },
      {
        name: 'ForgetPassword',
        path: 'forget-password',
        component: () =>
          import('#/views/_core/authentication/forget-password.vue'),
        meta: {
          title: $t('page.auth.forgetPassword'),
        },
      },
      {
        name: 'Register',
        path: 'register',
        component: () => import('#/views/_core/authentication/register.vue'),
        meta: {
          title: $t('page.auth.register'),
        },
      },
    ],
  },
];

export { coreRoutes, fallbackNotFoundRoute };
