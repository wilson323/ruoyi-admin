import { describe, expect, it } from 'vitest';

import { vbenCodesOf, vbenRolesOf } from './vben-identity';

/**
 * 2026-09-11 权限断链修复回归保护：
 * - roles 必须以 'superadmin' 形态进入 vben（否则 hasAccessByRoles(['superadmin'])
 *   整页守卫判否 → /system/menu、/system/tenant、/system/tenantPackage 403）；
 * - codes 必须让 SUPER_ADMIN 拿到 '*:*:*' 全通码（否则 v-access:code 全判否，
 *   完整登录后 46 个页面按钮全部不渲染）。
 */
describe('IPD 身份 → vben 边车语义映射', () => {
  it('SUPER_ADMIN：roles 映射为上游超管 key', () => {
    expect(vbenRolesOf('SUPER_ADMIN')).toEqual(['superadmin']);
  });

  it('SUPER_ADMIN：codes 拿全通码', () => {
    expect(vbenCodesOf('SUPER_ADMIN', 'FULL')).toEqual(['*:*:*']);
  });

  it('非超管：roles 保留 personType 原样', () => {
    expect(vbenRolesOf('MARKET_PM')).toEqual(['MARKET_PM']);
    expect(vbenRolesOf('GROUP_LEADER')).toEqual(['GROUP_LEADER']);
    expect(vbenRolesOf('RD_PM')).toEqual(['RD_PM']);
  });

  it('非超管：codes 维持 IPD 语义 [scope, personType:xxx]', () => {
    expect(vbenCodesOf('MARKET_PM', 'FULL')).toEqual(['FULL', 'personType:MARKET_PM']);
  });

  it('scope 为空段被过滤', () => {
    expect(vbenCodesOf('RD_PM', '')).toEqual(['personType:RD_PM']);
  });
});
