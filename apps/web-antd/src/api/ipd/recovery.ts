/**
 * 90 日回款预警（R149 后端实装；前端 /ipd/operation/recovery-warnings 路由承载）。
 *
 * 端点契约：
 * - POST /api/v1/recovery/check-90d  触发扫描（超管专属）
 *   body: { scanDate?: "YYYY-MM-DD" }  // 可选，默认后端当天
 *   resp: { triggeredCount: number, scanDate: string }
 * - GET  /api/v1/recovery/warnings   查预警列表（按可见范围过滤，服务端权威）
 *   resp: RecoveryWarningItem[]
 *
 * 权限码：
 * - ipd:recovery:check-90d      触发扫描动作
 * - ipd:recovery:warnings:query 列表查询
 */
import { ipdGet, ipdPost } from './http';

/** 单条预警条目（与后端 IpdRecoveryWarning DTO 一致）。 */
export interface RecoveryWarningItem {
  id: string;
  projectId: number;
  projectName: string;
  warningDate: string;
  recoveryDeadline: string;
  daysOverdue: number;
  amount: number;
  status: 'ACTIVE' | 'RESOLVED';
  createdAt: string;
}

/** 触发扫描响应。 */
export interface Check90dResp {
  triggeredCount: number;
  scanDate: string;
}

/**
 * 触发 90 日回款预警扫描。
 * @param scanDate 可选，格式 YYYY-MM-DD；省略时后端默认当天。
 */
export function checkRecovery90d(scanDate?: string): Promise<Check90dResp> {
  return ipdPost<Check90dResp>(
    '/api/v1/recovery/check-90d',
    scanDate ? { scanDate } : {},
  );
}

/** 查询 90 日回款预警列表（服务端按可见范围过滤）。 */
export function listRecoveryWarnings(): Promise<RecoveryWarningItem[]> {
  return ipdGet<RecoveryWarningItem[]>('/api/v1/recovery/warnings');
}
