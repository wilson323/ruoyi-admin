import type { RouteRecordRaw } from 'vue-router';

/**
 * 游客门户（页38/39）：免登录顶层路由，不套后台 basic 布局。
 * - ipd-guard.ts PUBLIC_PREFIXES=['/portal'] 已匿名放行；
 * - hideInMenu 防侧栏露面；
 * - 此模块从 ipd.ts 分离——门户域与登录域独立演进，避免互相污染。
 */
const portalRoutes: RouteRecordRaw[] = [
  {
    component: () => import('#/views/ipd/portal/submit/index.vue'),
    meta: { hideInMenu: true, title: '需求门户-提交需求' },
    name: 'IpdPortalSubmit',
    path: '/portal/submit',
  },
  {
    component: () => import('#/views/ipd/portal/status/index.vue'),
    meta: { hideInMenu: true, title: '需求门户-查询进度' },
    name: 'IpdPortalTrack',
    path: '/portal/track',
  },
];

export default portalRoutes;