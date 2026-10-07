/**
 * R185-P1 路由级权限码闸单测（M-Root-12 多套闸不同步 修复验证）
 *
 * 设计依据：
 * - docs/ipd-系统说明/权限三套体系边界-20260923.md §2.2
 * - docs/ipd-系统说明/隐式依赖三反模式-20260923.md §四
 *
 * 闸行为契约（4 条，必须 ALL PASS）：
 * 1. meta.access 空 → 放行（与 hasAuthority 语义对齐）
 * 2. SUPER_ADMIN 全通码 '*:*:*' → 放行（v-access:code 对齐）
 * 3. meta.access 任一权限码命中 accessCodes → 放行（OR）
 * 4. 都不满足 → 拦截（返回 false）
 *
 * FAIL_SEED 双向触发等价：4 个用例覆盖闸的全部 4 路径，无空隙即不会假绿。
 */

import type { RouteLocationNormalized } from 'vue-router';
import { describe, expect, it } from 'vitest';

import { hasAccess, isAuthPath } from './ipd-guard';

function makeRoute(access?: string[]): RouteLocationNormalized {
  return {
    meta: access !== undefined ? { access } : {},
  } as unknown as RouteLocationNormalized;
}

describe('R185-P1 hasAccess (route-level meta.access gate)', () => {
  it('空 meta.access → 放行（与 hasAuthority 一致语义）', () => {
    expect(hasAccess(makeRoute(), [])).toBe(true);
    expect(hasAccess(makeRoute(undefined), ['ipd:bid:create'])).toBe(true);
  });

  it('SUPER_ADMIN 全通码 → 放行', () => {
    expect(
      hasAccess(makeRoute(['BID_INVITATION_ADMIN_ASSIGN']), ['*:*:*']),
    ).toBe(true);
  });

  it('meta.access 任一权限码命中 accessCodes → 放行（OR）', () => {
    expect(
      hasAccess(
        makeRoute(['BID_INVITATION_ADMIN_ASSIGN', 'IPD_BID_EDIT']),
        ['IPD_BID_EDIT'],
      ),
    ).toBe(true);
  });

  it('通道已接通（codes 含 ipd: 码）且 meta.access 无一命中 → 拦截', () => {
    expect(
      hasAccess(makeRoute(['ipd:project:list']), [
        'ipd:bid:create',
        'personType:RD_PM',
      ]),
    ).toBe(false);
  });

  it('权限码通道未接通（codes 无任何 ipd: 码）→ 拦截（fail-closed，安全件 F-3 反转 R211b 口径）', () => {
    // 非超管现状：accessCodes = ['FULL','personType:RD_PM'] 或 []，不含 ipd: 码。
    // 旧实现（2026-09-24 R211b）在此 fail-open 放行、赌后端 403 兜底；现改为拦截：
    // 通道异常时静默放行会把「鉴权失效」伪装成「有权限」，失败长得像成功。
    expect(
      hasAccess(makeRoute(['ipd:project:list']), ['personType:RD_PM']),
    ).toBe(false);
    expect(hasAccess(makeRoute(['ipd:project:list']), [])).toBe(false);
  });

  it('meta.access 非空、accessCodes 为空 → 拦截（同上：空码集 = 通道未接通 = fail-closed）', () => {
    expect(
      hasAccess(makeRoute(['BID_INVITATION_ADMIN_ASSIGN']), []),
    ).toBe(false);
  });
});

describe('R215-P3 isAuthPath（redirect 目标排除 auth 区自身，卡 5370d5a3）', () => {
  it('auth 路径（登录/改密//login 别名/误入的 /ipd/auth/**，含携带 query 的 fullPath）→ true', () => {
    for (const p of [
      '/auth/login',
      '/login',
      '/auth/login?redirect=%2Fipd',
      '/ipd/auth/login', // 缺陷实测形态：登录成功后被弹回此路径 → catch-all 404
      '/ipd/auth/login?x=1',
      '/auth/change-password',
      '/auth',
      '/ipd/auth',
    ]) {
      expect(isAuthPath(p), p).toBe(true);
    }
  });

  it('业务/公开路径 → false（redirect 正常放行，不误伤）', () => {
    for (const p of [
      '/ipd/workbench',
      '/ipd/projects/42/overview',
      '/ipd/authority-config',
      '/portal/submit',
      '/system/user',
    ]) {
      expect(isAuthPath(p), p).toBe(false);
    }
  });
});
