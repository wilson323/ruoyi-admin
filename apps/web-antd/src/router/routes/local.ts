import type { RouteRecordStringComponent } from '@vben/types';

import { $t } from '@vben/locales';

/**
 * 该文件放非后台返回的路由 比如个人中心 等需要跳转显示的页面
 * 也可以直接在菜单管理配置
 */
const localRoutes: RouteRecordStringComponent[] = [
  {
    component: '/_core/profile/index',
    meta: {
      icon: 'mingcute:profile-line',
      title: $t('ui.widgets.profile'),
      hideInMenu: true,
      requireHomeRedirect: true,
    },
    name: 'Profile',
    path: '/profile',
  },
];

/**
 * 这里放本地路由
 *
 * 2026-09-12 移除 Dashboard（/ + /analytics + /workspace）段：vben 模板 demo 遗留，
 * 后端菜单模式下菜单里从未出现过；且 modules/dashboard.ts 静态注册的 /analytics
 * 不在 Root 布局树下，直达即「全屏」裸页（无侧栏/顶栏），已连带删除。
 */
export const localMenuList: RouteRecordStringComponent[] = [
  // {
  //   component: '/_core/about/index',
  //   meta: {
  //     icon: 'lucide:copyright',
  //     order: 9999,
  //     title: $t('demos.vben.about'),
  //   },
  //   name: 'About',
  //   path: '/vben-admin/about',
  // },
  ...localRoutes,
];
