/**
 * 90 日回款预警（前端 /ipd/operation/recovery-warnings）。
 *
 * ipdGet / ipdPost 会再拼 `/api/v1`，这里只写资源路径。
 * 运行时端点：
 * - POST /api/v1/recovery/check-90d?scanDate=YYYY-MM-DD  扫描日期走查询参数，返回新增条数
 * - GET  /api/v1/recovery/warnings?projectId=           预警列表，字段与 RecoveryWarning 一致
 *
 * 权限码：
 * - ipd:recovery:check-90d      触发扫描动作
 * - ipd:recovery:warnings:query 列表查询
 */
import { ipdGet, ipdPost } from './http';

/** 预警状态，与 RecoveryWarning.STATUS_* 一致。 */
export type RecoveryWarningStatus = 'HANDLED' | 'IGNORED' | 'PENDING';

/** 单条预警（与后端 RecoveryWarning 字段一致，不含项目名称）。 */
export interface RecoveryWarningItem {
  id: number | string;
  projectId: number | string;
  warningDate: string;
  daysSinceLaunch: number;
  recoveryRate: number | string;
  threshold: number | string;
  status: RecoveryWarningStatus;
}

/**
 * 触发 90 日回款预警扫描。
 *
 * 扫描日期必须放在查询参数上，后端按 @RequestParam 读取；请求体不会被读取。
 *
 * @param scanDate 可选，格式 YYYY-MM-DD；省略时后端取当天
 * @returns 本次新写入的预警条数
 */
export function checkRecovery90d(scanDate?: string): Promise<number> {
  return ipdPost<number>(
    '/recovery/check-90d',
    undefined,
    scanDate ? { scanDate } : undefined,
  );
}

/**
 * 查询 90 日回款预警列表。
 *
 * @returns 服务端按可见范围过滤后的预警列表
 */
export function listRecoveryWarnings(): Promise<RecoveryWarningItem[]> {
  return ipdGet<RecoveryWarningItem[]>('/recovery/warnings');
}
