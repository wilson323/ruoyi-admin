/**
 * HR 同步域只读清单接口（R215 WP3.1 批次 = ORPHAN-A8，卡 786da825；原型页 27）。
 *
 * 真值：HrSyncController GET /api/v1/hr-sync/pending-handovers（R212 分桶表 #28）——
 * 列出当前所有 FROZEN_PENDING_HANDOVER（离职冻结待移交）人员，权限 GROUP_LEADER +
 * SUPER_ADMIN；thresholdDays 默认 15（超龄行 escalate=true，15 日逾期升级 BR-USER-06）。
 *
 * 边界登记：
 * - 该端点属 HrSyncController（非 HandoverController），但产品归属移交域（页 27 待移交
 *   清单），消费入口在 views/ipd/handover（移交管理页）；与 A11 离职动作页
 *   views/ipd/admin/identity-sync 分工：那边做离职冻结/解绑操作，这边做冻结后清单跟踪，
 *   不重复造页面。
 * - HrSyncController 其余端点（mark-resigned/escalate-stale-resignations/sync-now/
 *   sync-one/last-run）为 R212 B 桶（HR 回调/运维/cron 手动兜底），前端不接。
 */
import { ipdGet } from './http';

/**
 * 待移交人员行（HrSyncController.PendingHandoverView）。
 *
 * 字段归一口径（live 证据 2026-09-25：personId/groupId 为雪花 ID，超 JS 安全整数，
 * 后端 BigNumberSerializer 以 string 下发，如 "2096266884247736321"）：
 * - ID 类字段（personId/groupId）string 透传（IPD /api/v1 大整数 ID 契约；Number() 会丢精度）；
 * - 计数类字段（activeProjects/ageDays）Number() 归一（BigNumberSerializer 安全范围内为 number）。
 */
export interface PendingHandoverPerson {
  /** 名下仍活跃的项目数（移交全部完成才终态 DISABLED）。 */
  activeProjects: number;
  /** 距冻结天数。 */
  ageDays: number;
  employeeNo: null | string;
  /** 是否已触发 15 日倒计时升级（BR-USER-06）。 */
  escalate: boolean;
  frozenSince: null | string;
  groupId: null | string;
  name: string;
  personId: string;
}

/**
 * 离职待移交清单（FROZEN_PENDING_HANDOVER 人员；组长+超管）。
 * thresholdDays 省略时用后端默认 15（不拼 query，交由后端 defaultValue 兜底）。
 */
export async function listPendingHandovers(thresholdDays?: number): Promise<PendingHandoverPerson[]> {
  const rows = await ipdGet<unknown[]>(
    '/hr-sync/pending-handovers',
    thresholdDays === undefined ? undefined : { thresholdDays },
  );
  return (rows ?? []).map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      activeProjects: Number(row.activeProjects ?? 0),
      ageDays: Number(row.ageDays ?? 0),
      employeeNo: row.employeeNo == null ? null : String(row.employeeNo),
      escalate: row.escalate === true,
      frozenSince: row.frozenSince == null ? null : String(row.frozenSince),
      groupId: row.groupId == null ? null : String(row.groupId),
      name: String(row.name ?? ''),
      personId: String(row.personId ?? ''),
    };
  });
}
