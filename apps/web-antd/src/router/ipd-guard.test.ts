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

import { hasAccess } from './ipd-guard';

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

  it('meta.access 无一命中且非超管 → 拦截', () => {
    expect(
      hasAccess(
        makeRoute(['BID_INVITATION_ADMIN_ASSIGN']),
        ['personType:RD_PM'],
      ),
    ).toBe(false);
  });

  it('meta.access 非空但 accessCodes 为空 → 拦截', () => {
    expect(
      hasAccess(makeRoute(['BID_INVITATION_ADMIN_ASSIGN']), []),
    ).toBe(false);
  });
});
