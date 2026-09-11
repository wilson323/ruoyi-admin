import type { RouteRecordRaw } from 'vue-router';

import { mergeRouteModules, traverseTreeValues } from '@vben/utils';

import { coreRoutes, fallbackNotFoundRoute } from './core';

const dynamicRouteFiles = import.meta.glob('./modules/**/*.ts', {
  eager: true,
});

// 有需要可以自行打开注释，并创建文件夹
// const externalRouteFiles = import.meta.glob('./external/**/*.ts', { eager: true });
// const staticRouteFiles = import.meta.glob('./static/**/*.ts', { eager: true });

/** 动态路由 */
const dynamicRoutes: RouteRecordRaw[] = mergeRouteModules(dynamicRouteFiles);

/**
 * 2026-09-11 owner 指令（菜单/UI 统一）：IPD 自绘壳废弃，/ipd 路由树并入 Root.children，
 * 与 AI 管理平台动态路由共用同一个 vben BasicLayout 实例（单壳、单菜单）。
 * 若不并入，/ipd 命中的是顶层静态路由，会另起一份 BasicLayout 实例——
 * 壳随路由族切换而重建、keep-alive 缓存分裂。
 */
const rootRoute = coreRoutes.find((route) => route.name === 'Root');
const ipdRouteIndex = dynamicRoutes.findIndex((route) => route.path === '/ipd');
const ipdRoute = dynamicRoutes[ipdRouteIndex];
if (rootRoute?.children && ipdRoute) {
  rootRoute.children.push(ipdRoute);
  dynamicRoutes.splice(ipdRouteIndex, 1);
}

/** 外部路由列表，访问这些页面可以不需要Layout，可能用于内嵌在别的系统(不会显示在菜单中) */
// const externalRoutes: RouteRecordRaw[] = mergeRouteModules(externalRouteFiles);
// const staticRoutes: RouteRecordRaw[] = mergeRouteModules(staticRouteFiles);
const staticRoutes: RouteRecordRaw[] = [];
const externalRoutes: RouteRecordRaw[] = [];

/** 路由列表，由基本路由、外部路由和404兜底路由组成
 *  无需走权限验证（会一直显示在菜单中） */
const routes: RouteRecordRaw[] = [
  ...coreRoutes,
  ...dynamicRoutes,
  ...externalRoutes,
  fallbackNotFoundRoute,
];

/** 基本路由(登录, 第三方登录, 注册等)  */
const basicRoutes = [...coreRoutes];
/** 基本路由列表，这些路由不需要进入权限拦截 */
const coreRouteNames = traverseTreeValues(basicRoutes, (route) => route.name);

/** 有权限校验的路由列表，包含动态路由和静态路由 */
const accessRoutes = [...dynamicRoutes, ...staticRoutes];
export { accessRoutes, coreRouteNames, routes };
