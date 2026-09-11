/**
 * IPD 身份 → vben 边车语义映射（2026-09-11 权限断链修复）。
 *
 * <p>背景（浏览器实测实锤，2026-09-11）：
 * <ul>
 *   <li>vben 遗留体系：userStore.userRoles 装角色 key（小写 'superadmin'），
 *       hasAccessByRoles(['superadmin']) 是 /system/menu、/system/tenant、
 *       /system/tenantPackage 等页面的整页守卫；accessStore.accessCodes 中
 *       '*:*:*' 代表超管全通，v-access:code 指令逐码判定。</li>
 *   <li>IPD 通道（2026-09-10 起 getInfo 改走 /auth/me）：personType 为大写枚举
 *       （SUPER_ADMIN 等），accessCodes 被写入 [scope, 'personType:xxx']。
 *       两套语义脱节 → ① 超管访问 /system/menu 等页面被整页 403
 *       （roles=['SUPER_ADMIN'] 不含 'superadmin'）；② 任何一次完整登录把
 *       accessCodes 覆盖为 [scope, 'personType:xxx'] 后，46 个页面（含 AI 平台）
 *       的 v-access:code 按钮全部不渲染（实测：覆盖前新增/编辑/删除/导出/导入
 *       全在，覆盖后全部消失）。此前未暴露是因本机 localStorage 残留着更早
 *       RuoYi 通道（/system/user/getInfo）写入的 ['*:*:*']。</li>
 * </ul>
 *
 * <p>注：非超管用户的 IPD 权限码（ipd:xxx）下发链路属在案未闭环项
 * （docs/ipd-系统说明/log.md「V1 按钮级 v-access:code 消费 accessCodes」），
 * 本次不扩面，非超管维持 [scope, personType:xxx] 现状。
 */

/** personType → vben 角色 key 列表（SUPER_ADMIN 对齐上游超管 'superadmin'）。 */
export function vbenRolesOf(personType: string): string[] {
  return personType === 'SUPER_ADMIN' ? ['superadmin'] : [personType];
}

/**
 * personType/scope → accessCodes（SUPER_ADMIN 拿 '*:*:*' 全通码，其余维持 IPD 语义）。
 * userStore.userInfo.permissions 与 accessStore.accessCodes 共用本函数，避免双源漂移。
 */
export function vbenCodesOf(personType: string, scope: string): string[] {
  if (personType === 'SUPER_ADMIN') return ['*:*:*'];
  return [scope, `personType:${personType}`].filter(Boolean);
}
