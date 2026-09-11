import type { RouteLocationNormalized } from 'vue-router';
import type { IpdIdentity } from '../api/ipd/auth';

import { useAccessStore } from '@vben/stores';

import type { MenuRecordRaw } from '@vben/types';

import { useIpdAuthStore } from '../store/ipd-auth';
import { generatePlatformAccess } from './access';

export const IPD_LOGIN = '/auth/login';
export const IPD_PASSWORD = '/auth/change-password';
export const IPD_ACCOUNT = '/ipd/account';
export const IPD_HOME = '/ipd/workbench';
export const IPD_NO_ACCESS = '/ipd/no-access';

/** 匿名可访问面：登录区 + 游客门户（38/39 免登录，不套后台布局）。 */
const PUBLIC_PREFIXES = ['/portal'];
const PUBLIC_PATHS = new Set([IPD_LOGIN, '/login']);

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 冻结移交期（HANDOVER_ONLY）仅移交相关面可用：账户页 + 项目移交页（BR-HAND/AC-HAND-01b）。 */
function handoverSurface(path: string): boolean {
  return path === IPD_ACCOUNT || path === '/ipd/handover' || path.startsWith('/ipd/handover/');
}

/**
 * 身份 → 目的地（纯函数，便于契约测试）。
 * - 匿名：仅登录区与游客门户；
 * - 待改密：只能停留在改密页（AC-AUTH-02）；
 * - 冻结移交：仅移交面，其余回账户页；
 * - 已登录 FULL：/ipd/** 与游客门户放行；非 /ipd 路径（AI 平台区，2026-09-06 owner 指令
 *   「后端所有功能前端一一完整展示」）仅在持平台票时放行，否则维持弹回工作台。
 */
export function identityDestination(path: string, identity: IpdIdentity | null, platformReady = false): string | true {
  if (!identity) {
    if (isPublic(path)) return true;
    return path === IPD_LOGIN || path === '/login' ? true : IPD_LOGIN;
  }
  if (identity.mustChangePwd || identity.scope === 'PASSWORD_CHANGE_REQUIRED') {
    return path === IPD_PASSWORD ? true : IPD_PASSWORD;
  }
  if (identity.scope === 'HANDOVER_ONLY') {
    return handoverSurface(path) ? true : IPD_ACCOUNT;
  }
  if (path === IPD_ACCOUNT || isPublic(path)) return true;
  if (!path.startsWith('/ipd')) return platformReady ? true : IPD_HOME;
  return true;
}

function hasAuthority(to: RouteLocationNormalized, identity: IpdIdentity): boolean {
  const authority = to.meta.authority;
  if (!authority || authority.length === 0) return true;
  return authority.includes(identity.person.personType);
}

/** 按角色生成侧边栏菜单：非超管剔除带 authority 的受限子树（导航地图权限矩阵）。 */
let menusBuiltForRole = '';
let menusBuiltWithPlatform = false;
let platformRoutesReady = false;
/** 平台票每次页面加载只尝试静默续签一次（无映射账号/接口不可用时不重复打） */
let platformHydrationAttempted = false;

/** 平台（AI 管理平台）动态路由：仅在持平台票后挂载一次；失败静默降级为纯 IPD。 */
let platformMenusCache: MenuRecordRaw[] = [];
async function ensurePlatformAccess(router: import('vue-router').Router): Promise<MenuRecordRaw[]> {
  // 已挂载时返回缓存菜单而非空数组：enterPlatform 依赖菜单计算落地路径，
  // 空——会被误判为「菜单为空」而中断切换（2026-09-06 浏览器实测修复）
  if (platformRoutesReady) return platformMenusCache;
  const { accessibleMenus } = await generatePlatformAccess(router);
  platformRoutesReady = true;
  platformMenusCache = accessibleMenus;
  return accessibleMenus;
}

/**
 * accessMenus 仅承载 AI 管理平台菜单（basic.vue 侧边栏数据源）。
 * IPD 工作台侧边栏为原型 15 项硬编码，不消费 accessMenus
 * （2026-09-06 owner 指令：左下角整体切换「IPD 工作台 ⇄ AI 管理平台」，不混排菜单）。
 */
async function buildAccessMenus(
  to: RouteLocationNormalized,
  router: import('vue-router').Router,
  personType: string,
): Promise<true | { path: string; replace: boolean }> {
  const accessStore = useAccessStore();
  let menus: MenuRecordRaw[] = [];
  const platformReady = Boolean(accessStore.accessToken);
  if (platformReady) {
    try {
      menus = await ensurePlatformAccess(router);
    } catch {
      // 平台菜单不可用（接口失败/无权限）：保持空菜单，仅失去 AI 平台侧边栏，不影响 IPD 会话
    }
  }
  accessStore.setAccessMenus(menus);
  accessStore.setIsAccessChecked(true);
  menusBuiltForRole = personType;
  menusBuiltWithPlatform = platformReady;
  // 动态挂载发生在本次导航解析之后：若 to 仅匹配到 catch-all not-found，用已挂载路由重导航一次
  if (platformReady && menus.length > 0 && to.matched.some((record) => record.path.includes(':path'))) {
    return { path: to.fullPath, replace: true };
  }
  return true;
}

/**
 * 进入 AI 管理平台（IPD 工作台左下角切换入口，2026-09-06 owner 指令）：
 * 续签平台票 → 挂载平台路由与菜单 → 返回平台落地路径（首个可见叶子，如 /chat/provider）。
 * 抛出异常表示换票失败（无映射账号/接口不可用），由调用方提示，不改变当前 IPD 界面。
 */
export async function enterPlatform(router: import('vue-router').Router): Promise<string> {
  const auth = useIpdAuthStore();
  await auth.renewPlatformSession(true);
  const menus = await ensurePlatformAccess(router);
  const accessStore = useAccessStore();
  accessStore.setAccessMenus(menus);
  accessStore.setIsAccessChecked(true);
  menusBuiltWithPlatform = true;
  const first = menus[0];
  const leaf = first?.children?.[0]?.path ?? first?.path ?? '';
  if (!leaf) throw new Error('平台菜单为空，无法进入 AI 管理平台');
  return leaf.startsWith('/') ? leaf : `/${first?.path ?? ''}/${leaf}`.replaceAll('//', '/');
}

/**
 * /auth/me 的会话级缓存（断网容忍）。
 * - 已登录用户每 60s 最多调一次远端身份刷新，期间复用上次身份判断权限；
 * - 刷新失败且 token 未过期时降级放行 + 静默记录到 auth.error（不弹登录页）；
 * - token 已过期或身份缺失才强制回登录页。
 */
const IDENTITY_TTL_MS = 60_000;
let identityFetchedAt = 0;
let identityInFlight: Promise<unknown> | null = null;

export async function ipdNavigationGuard(to: RouteLocationNormalized, router: import('vue-router').Router) {
  const auth = useIpdAuthStore();
  const accessStore = useAccessStore();
  if (auth.token) {
    const stale = Date.now() - identityFetchedAt > IDENTITY_TTL_MS;
    if (stale && !identityInFlight) {
      identityInFlight = auth
        .refreshIdentity()
        .then(() => {
          identityFetchedAt = Date.now();
        })
        .catch((cause) => {
          // 区分：身份解析/401 真失效 vs 网络抖动（transport/protocol 类）
          const err = cause as { kind?: string; status?: number };
          const networkOnly = !auth.token || err?.kind === 'transport' || err?.kind === 'protocol';
          if (networkOnly && auth.token) {
            auth.error = err?.kind === 'transport' ? '网络异常，已使用上次会话身份' : '服务响应异常，已使用上次会话身份';
            return; // 降级放行
          }
          // 真失效：清身份，让下面 anonymous 分支强制回登录页
          auth.error = cause instanceof Error ? cause.message : '无法确认登录状态，请重试';
          auth.clearSession();
        })
        .finally(() => {
          identityInFlight = null;
        });
      try { await identityInFlight; } catch { /* 已在内部分类处理 */ }
    } else if (identityInFlight) {
      try { await identityInFlight; } catch { /* 已在内部分类处理 */ }
    }
  }

  const identity = auth.identity;
  if (!identity) {
    const destination = identityDestination(to.path, null);
    return destination === true ? true
      : { path: destination, query: to.fullPath === IPD_HOME ? {} : { redirect: to.fullPath }, replace: true };
  }
  if (identity.mustChangePwd || identity.scope === 'PASSWORD_CHANGE_REQUIRED') {
    return to.path === IPD_PASSWORD ? true : { path: IPD_PASSWORD, replace: true };
  }
  if (to.path === IPD_PASSWORD) return { path: IPD_HOME, replace: true };

  // 角色门槛：无权访问 → 统一提示页（导航地图权限矩阵）
  if (!hasAuthority(to, identity)) return { path: IPD_NO_ACCESS, replace: true };

  // AI 平台桥：平台票缺失（如刷新页面后）先静默续签一次；失败仅失去平台入口，不影响 IPD 会话
  if (identity.scope === 'FULL' && !accessStore.accessToken && !platformHydrationAttempted) {
    platformHydrationAttempted = true;
    try { await auth.renewPlatformSession(); } catch { /* 降级 */ }
  }

  const destination = identityDestination(to.path, identity, Boolean(accessStore.accessToken));
  if (destination !== true) {
    return typeof destination === 'string'
      ? { path: destination, replace: true }
      : destination;
  }

  if (menusBuiltForRole !== identity.person.personType || menusBuiltWithPlatform !== Boolean(accessStore.accessToken)) {
    const rebuilt = await buildAccessMenus(to, router, identity.person.personType);
    if (rebuilt !== true) return rebuilt;
  }
  return true;
}
