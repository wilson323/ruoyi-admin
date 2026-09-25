/**
 * 角色权限配置接口（R215 权限可配置化，owner 指令 2026-09-24「确保权限可配置化」）。
 *
 * 设计：
 * - 数据源：ipd_role_permission 表（DB 覆盖层）；有效集 = Java 默认 ∪ GRANT − REVOKE，
 *   表空 ⇒ 纯 Java 默认（fail-closed，见后端 IpdRolePermissionCatalog 注释）；
 * - 元权限码（ipd:role-permission:*）不参与 DB 配置（后端自举保护，双端拒绝）；
 * - create/delete 后端即时 reload，无需重启；method 上仅有 DELETE 端点用 ipdDelete。
 *
 * 端点（后端 IpdRolePermissionController，全部仅 SUPER_ADMIN）：
 * - GET    /api/v1/role-permissions           → 覆盖行列表
 * - GET    /api/v1/role-permissions/effective → 各角色四层快照（默认/GRANT/REVOKE/生效）
 * - POST   /api/v1/role-permissions           → 新增覆盖行（remark 必填留痕 + 审计）
 * - DELETE /api/v1/role-permissions/{id}      → 删除覆盖行（该码回退 Java 默认）
 * - POST   /api/v1/role-permissions/reload    → 手工重建覆盖层（DBA 直改表后同步）
 */
import { ipdDelete, ipdGet, ipdPost } from './http';

export type RolePermissionEffect = 'GRANT' | 'REVOKE';

/** 覆盖行（后端 IpdRolePermission 实体；id 走 IPD 字符串 ID 契约）。 */
export interface RolePermissionRow {
  createTime: null | string;
  effect: RolePermissionEffect;
  id: string;
  personType: string;
  permissionCode: string;
  remark: null | string;
}

/** 单角色四层快照。 */
export interface RoleEffectiveLayers {
  dbGrant: string[];
  dbRevoke: string[];
  effective: string[];
  javaDefault: string[];
}

/** personType → 四层快照。 */
export type EffectiveSnapshot = Record<string, RoleEffectiveLayers>;

/** 新增覆盖行请求体（对齐后端 RolePermissionReq record，remark 必填）。 */
export interface RolePermissionCreateReq {
  effect: RolePermissionEffect;
  permissionCode: string;
  personType: string;
  remark: string;
}

/** 覆盖行列表（仅 DB 配置行，不含 Java 默认）。 */
export function listRolePermissions(): Promise<RolePermissionRow[]> {
  return ipdGet<RolePermissionRow[]>('/role-permissions');
}

/** 各角色有效快照（配置页数据源：默认基准线 + 覆盖增量 + 最终生效集）。 */
export function getEffectivePermissions(): Promise<EffectiveSnapshot> {
  return ipdGet<EffectiveSnapshot>('/role-permissions/effective');
}

/** 新增覆盖行（后端校验：仅四已知角色、非元权限码、同角色同码查重；成功后即时生效）。 */
export function createRolePermission(body: RolePermissionCreateReq): Promise<RolePermissionRow> {
  return ipdPost<RolePermissionRow>('/role-permissions', body);
}

/** 删除覆盖行（该权限码回退 Java 默认集；即时生效）。 */
export function deleteRolePermission(id: string): Promise<null> {
  return ipdDelete<null>(`/role-permissions/${id}`);
}

/** 手工重建覆盖层（DBA 绕过 API 直改表后的同步按钮；返回各侧角色数）。 */
export function reloadRolePermissions(): Promise<{ grantRoles: number; revokeRoles: number }> {
  return ipdPost<{ grantRoles: number; revokeRoles: number }>('/role-permissions/reload');
}
