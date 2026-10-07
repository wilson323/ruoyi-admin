/**
 * IPD 身份 → vben 边车语义映射（2026-09-11 权限断链修复；2026-09-24 R211b 接真权限码）。
 *
 * <p>背景（浏览器实测实锤，2026-09-11）：
 * <ul>
 *   <li>vben 遗留体系：userStore.userRoles 装角色 key（小写 'superadmin'），
 *       hasAccessByRoles(['superadmin']) 是 /system/menu、/system/tenant、
 *       /system/tenantPackage 等页面的整页守卫；accessStore.accessCodes 中
 *       '*:*:*' 代表超管全通，v-access:code 指令逐码判定。</li>
 *   <li>IPD 通道（2026-09-10 起 getInfo 改走 /auth/me）：personType 为大写枚举
 *       （SUPER_ADMIN 等）。历史非超管 accessCodes 仅 [scope, 'personType:xxx']，
 *       导致 meta.access 闸无 ipd: 码可判；R211b 临时放行后由后端 403 兜底。
 *       正修：/auth/me 下发 person.permissionCodes（IpdRolePermissionCatalog），
 *       本函数优先透传，闸恢复真拦截。</li>
 * </ul>
 */

/** personType → vben 角色 key 列表（SUPER_ADMIN 对齐上游超管 'superadmin'）。 */
export function vbenRolesOf(personType: string): string[] {
  return personType === 'SUPER_ADMIN' ? ['superadmin'] : [personType];
}

/**
 * personType/scope → accessCodes。
 * 优先使用后端 permissionCodes（含 ipd: 码）；否则 SUPER_ADMIN 全通、其余降级 scope/personType。
 *
 * @param personType IPD 人员类型
 * @param scope 会话 scope
 * @param permissionCodes 后端 PersonView.permissionCodes，可选
 * @returns 写入 accessStore.accessCodes / userInfo.permissions 的码表
 */
export function vbenCodesOf(
  personType: string,
  scope: string,
  permissionCodes?: string[],
): string[] {
  if (personType === 'SUPER_ADMIN') return ['*:*:*'];
  if (
    permissionCodes &&
    permissionCodes.length > 0 &&
    permissionCodes.some((code) => code.startsWith('ipd:') || code === '*:*:*')
  ) {
    return [...permissionCodes];
  }
  return [scope, `personType:${personType}`].filter(Boolean);
}

/**
 * IPD 码 ∪ 平台 RBAC 码（2026-10-07 非超管平台按钮断链修复）。
 *
 * accessStore.accessCodes 是两类闸的共同数据源：IPD 壳页面 meta.access 判 ipd:* 码，
 * 平台模块 v-access:code 判 system:* 码（如知识库 system:info:*）——换票后两套都必须装入
 * （判定为「含」语义，不怕多装）。去重保序，IPD 码在前。
 *
 * @param ipdCodes vbenCodesOf 产出的 IPD 侧码（含超管 '*:*:*'）
 * @param platformCodes fetchPlatformAccessCodes 取到的映射账号 RBAC 码，可为空
 */
export function mergeAccessCodes(ipdCodes: string[], platformCodes: string[]): string[] {
  if (platformCodes.length === 0) return ipdCodes;
  return [...new Set([...ipdCodes, ...platformCodes])];
}
