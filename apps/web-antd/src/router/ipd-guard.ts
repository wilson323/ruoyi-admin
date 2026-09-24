import type { RouteLocationNormalized } from 'vue-router';
import type { IpdIdentity } from '../api/ipd/auth';

import { useAccessStore, useUserStore } from '@vben/stores';

import type { MenuRecordRaw } from '@vben/types';

import { useIpdAuthStore } from '../store/ipd-auth';
import { vbenRolesOf } from '../store/vben-identity';
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

/**
 * 路由级权限码闸（R185-P1）：读 meta.access，与 accessStore.accessCodes 做匹配。
 * - 空数组 → 放行（与 hasAuthority 一致语义）
 * - SUPER_ADMIN 全通码 '*:*:*' → 放行（vben v-access:code 语义对齐）
 * - meta.access 任一权限码在 accessCodes 里 → 放行（OR 语义）
 * - 权限码通道未接通（accessCodes 无任何 ipd: 码）→ 放行，由后端 @SaCheckPermission/403 兜底
 *   （2026-09-24 R211b 运行态实测修复：后端尚未把 ipd: 码下发进 accessCodes，
 *   非超管 accessCodes 恒为 []/['FULL','personType:X']，原实现在此处把全部非超管角色
 *   从 24 条业务路由误拦到 /ipd/no-access；通道接通后本分支自动失效、闸恢复真拦截）
 * - 通道已接通且都不满足 → 路由层拦截 → /ipd/no-access
 *
 * 设计依据: docs/ipd-系统说明/权限三套体系边界-20260923.md §2.2（meta.access 装饰性实锤）
 *            docs/ipd-系统说明/隐式依赖三反模式-20260923.md §四（M-Root-12 多套闸不同步）
 */
export function hasAccess(to: RouteLocationNormalized, accessCodes: string[]): boolean {
  const access = to.meta.access as string[] | undefined;
  if (!access || access.length === 0) return true;
  if (accessCodes.includes('*:*:*')) return true;
  if (access.some((code) => accessCodes.includes(code))) return true;
  if (!accessCodes.some((code) => code.startsWith('ipd:'))) {
    // 权限码下发通道未接通：路由闸没有判断依据，放行并依赖后端 403 兜底（前端比后端严 = 误伤）。
    console.warn('[ipd-guard] meta.access 闸：accessCodes 不含任何 ipd: 权限码，通道未接通，本路由放行由后端鉴权兜底', to.path);
    return true;
  }
  return false;
}

/** 已构建菜单对应的角色（personType）：与当前身份不一致时重建（菜单接口按角色返回，导航地图权限矩阵）。 */
let menusBuiltForRole = '';
let platformRoutesReady = false;
/** 平台票每次页面加载只尝试静默续签一次（无映射账号/接口不可用时不重复打） */
let platformHydrationAttempted = false;

/** 统一菜单（AI 平台 + IPD 工作台分组）动态路由：构建成功后缓存；失败静默降级为空白侧栏。 */
let platformMenusCache: MenuRecordRaw[] = [];

/**
 * 清空侧栏菜单模块缓存（登出 / 换角色前调用）。
 * 若不清理，下一账号会复用上一角色的 platformMenusCache，首帧侧栏残留超管菜单项。
 */
export function resetIpdAccessMenuCache(): void {
  menusBuiltForRole = '';
  platformRoutesReady = false;
  platformMenusCache = [];
  platformHydrationAttempted = false;
}

/** 统一菜单（AI 平台 + IPD 工作台分组）动态路由：构建成功后缓存；失败静默降级为空白侧栏。 */
async function ensurePlatformAccess(router: import('vue-router').Router): Promise<MenuRecordRaw[]> {
  // 已挂载时返回缓存菜单而非空数组：caller 依赖菜单计算侧栏渲染与重导航
  // （2026-09-06 浏览器实测修复）
  if (platformRoutesReady) return platformMenusCache;
  const { accessibleMenus } = await generatePlatformAccess(router);
  platformRoutesReady = true;
  platformMenusCache = accessibleMenus;
  return accessibleMenus;
}

/**
 * accessMenus 承载统一侧栏菜单（vben BasicLayout 侧边栏数据源，2026-09-11 owner 指令：
 * 菜单/UI 统一——AI 平台与 IPD 工作台合并为同一份菜单）。
 * 菜单接口走 IPD 票（getAllMenusApi→ipdGet），与平台票是否就绪无关；
 * 失败时不落位 menusBuiltForRole，下次导航自动重试。
 */
async function buildAccessMenus(
  to: RouteLocationNormalized,
  router: import('vue-router').Router,
  personType: string,
): Promise<true | { path: string; replace: boolean }> {
  const accessStore = useAccessStore();
  // 换角色必须丢弃上一角色菜单缓存，否则 ensurePlatformAccess 短路返回超管 16 项（R211b）。
  platformRoutesReady = false;
  platformMenusCache = [];
  accessStore.setAccessMenus([]);
  let menus: MenuRecordRaw[] = [];
  try {
    menus = await ensurePlatformAccess(router);
    menusBuiltForRole = personType;
  } catch {
    // 菜单接口失败（网络/未授权）：留空侧栏，下次导航重试；不影响 IPD 会话与页面渲染
  }
  // IPD 工作台分组置顶（统一菜单中 IPD 主线业务优先；其余分组保持后端顺序）
  const ipdIndex = menus.findIndex((menu) => menu.path === '/ipd' || menu.name === 'IPD 工作台');
  if (ipdIndex > 0) {
    const [ipdMenu] = menus.splice(ipdIndex, 1);
    if (ipdMenu) menus.unshift(ipdMenu);
  }
  accessStore.setAccessMenus(menus);
  accessStore.setIsAccessChecked(true);
  // 动态挂载发生在本次导航解析之后：若 to 仅匹配到 catch-all not-found，用已挂载路由重导航一次
  if (menus.length > 0 && to.matched.some((record) => record.path.includes(':path'))) {
    return { path: to.fullPath, replace: true };
  }
  return true;
}

/**
 * 进入 AI 平台（顶栏用户菜单入口，2026-09-21 P3 拍板「入口恢复」）。
 *
 * 历史：2026-09-06 owner 指令为 IPD 自绘壳左下角「AI 管理平台」切换钮；2026-09-11 单壳统一
 * （c6e9bb7 三切换钮全删）后入口丢失。本函数按当年实现原样恢复：续签平台票 → 复用/挂载
 * 统一菜单 → 返回落地路径。差异只有一处：单壳统一后菜单首项是置顶的「IPD 工作台」分组，
 * 落地路径必须跳过它取 AI 平台分组首叶，否则「进入 AI 平台」会原地弹回 IPD。
 *
 * 后端端点实测存在（POST /api/v1/auth/platform-token → 401/20001「未认证」，需 IPD 票）。
 * 抛出异常 = 换票失败（无映射账号 / 账号非 FULL / 端点不可用）；调用方 toast 原文，
 * 不改当前界面、不静默跳转（诚实降级；文案统一走 ipd-error-text 权威源，不另造口径）。
 */
export async function enterPlatform(router: import('vue-router').Router): Promise<string> {
  const auth = useIpdAuthStore();
  await auth.renewPlatformSession(true);
  const menus = await ensurePlatformAccess(router);
  const accessStore = useAccessStore();
  accessStore.setAccessMenus(menus);
  accessStore.setIsAccessChecked(true);
  // 跳过置顶的 IPD 工作台分组（单壳统一后的差异点），取 AI 平台分组首叶
  const platformMenus = menus.filter((m) => m.path !== '/ipd' && m.name !== 'IPD 工作台');
  const first = platformMenus[0] ?? menus[0];
  const leaf = first?.children?.[0]?.path ?? first?.path ?? '';
  if (!leaf) throw new Error('平台菜单为空，无法进入 AI 平台');
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
  const userStore = useUserStore();
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
  // 权限码门槛（R185-P1）：meta.access 与 accessCodes 双重闸，闸间短路 OR
  if (!hasAccess(to, accessStore.accessCodes)) return { path: IPD_NO_ACCESS, replace: true };

  // 统一壳配套（2026-09-11）：vben userStore 无持久化，刷新后顶栏用户区为空；
  // 以 IPD 会话身份幂等补注（renewPlatformSession 缓存命中路径不会重设 userInfo）。
  const person = identity.person;
  if (userStore.userInfo?.username !== person.username) {
    userStore.setUserInfo({
      avatar: '',
      email: '',
      permissions: userStore.userInfo?.permissions ?? [],
      realName: person.name,
      // 2026-09-11 权限断链修复：经 vben-identity 映射（SUPER_ADMIN → 'superadmin'），
      // 与 authLogin / renewPlatformSession 三处安装点同源，修复 /system 整页守卫 403。
      roles: vbenRolesOf(person.personType),
      userId: person.id as unknown as number,
      username: person.username,
    });
  }

  // 平台票桥接：缺失（如刷新页面后）先静默续签一次；失败则非 /ipd 页面维持弹回工作台，不影响 IPD 会话
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

  if (menusBuiltForRole !== identity.person.personType) {
    // 登出后 menusBuiltForRole 可能仍是旧角色：先复位再重建，确保不命中旧缓存
    if (menusBuiltForRole) {
      resetIpdAccessMenuCache();
    }
    const rebuilt = await buildAccessMenus(to, router, identity.person.personType);
    if (rebuilt !== true) return rebuilt;
  }
  return true;
}
