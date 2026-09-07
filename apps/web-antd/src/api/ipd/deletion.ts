/**
 * 删除审核域 API（P0-6.x）：两级审核 + 撤回 + 归档区。
 *
 * 端点均挂在 /api/v1/deletion-requests（前缀由 requestIpd 统一补齐）：
 * - 决策端点（leader-decision / admin-decision）的 approve/opinion 是查询参数，无请求体；
 * - 「我的申请 / 待我审核」列表查询端点后端未交付，页面以发起表单、按编号决策与归档区呈现；
 * - 24h 撤回窗口（BR-DEL-04 / AC-DEL-06）由前端按 createTime 计算。
 */
import { ipdGet, ipdPost } from './http';

export type DeletionEntityType = 'cert_templates' | 'gates' | 'persons' | 'products' | 'projects';

export const DELETION_ENTITY_TYPES: { label: string; value: DeletionEntityType }[] = [
  { value: 'projects', label: '项目' },
  { value: 'products', label: '产品' },
  { value: 'persons', label: '人员' },
  { value: 'cert_templates', label: '认证模板' },
  { value: 'gates', label: 'Gate 评审' },
];

export const DELETION_STATUS_TEXT: Record<string, string> = {
  ADMIN_REVIEW: '超管终审中',
  DELETED: '已删除（归档）',
  LEADER_REVIEW: '组长初审中',
  REJECTED: '已驳回',
  WITHDRAWN: '已撤回',
};

export interface DeletionRequest {
  id: string;
  entityType: string;
  entityId: string;
  entitySnapshot?: string;
  reason?: string;
  requesterId: string;
  status: string;
  leaderId?: string;
  leaderDecision?: string;
  leaderDecidedAt?: string;
  leaderDueAt?: string;
  adminId?: string;
  adminDecision?: string;
  adminDecidedAt?: string;
  adminDueAt?: string;
  executedAt?: string;
  remark?: string;
  createTime?: number | string;
}

export interface DeletionSubmitReq {
  entityType: string;
  entityId: string;
  reason: string;
  snapshot?: string;
}

export function submitDeletionRequest(req: DeletionSubmitReq): Promise<DeletionRequest> {
  return ipdPost('/deletion-requests', req);
}

export function withdrawDeletionRequest(id: string): Promise<DeletionRequest> {
  return ipdPost(`/deletion-requests/${id}/withdraw`);
}

export function leaderDecideDeletion(id: string, approve: boolean, opinion?: string): Promise<DeletionRequest> {
  return ipdPost(`/deletion-requests/${id}/leader-decision`, undefined, { approve, opinion });
}

export function adminDecideDeletion(id: string, approve: boolean, opinion?: string): Promise<DeletionRequest> {
  return ipdPost(`/deletion-requests/${id}/admin-decision`, undefined, { approve, opinion });
}

export function listDeletionArchive(): Promise<DeletionRequest[]> {
  return ipdGet('/deletion-requests/archive');
}

export function purgeDeletionRequest(id: string): Promise<DeletionRequest> {
  return ipdPost(`/deletion-requests/${id}/purge`);
}

export function escalateOverdueLeaderReview(): Promise<{ escalated: number }> {
  return ipdPost('/deletion-requests/escalate-overdue');
}

export function listOverdueAdminReview(): Promise<DeletionRequest[]> {
  return ipdGet('/deletion-requests/overdue-admin-review');
}

/** 24h 撤回窗口（BR-DEL-04）：兼容 "yyyy-MM-dd HH:mm:ss" / ISO / 毫秒时间戳三种时间形态。 */
export function withinWithdrawWindow(
  createTime: null | number | string | undefined,
  now = Date.now(),
  hours = 24,
): boolean {
  if (createTime === undefined || createTime === null || createTime === '') return false;
  const raw = typeof createTime === 'number' ? createTime
    : Date.parse(createTime.includes('T') ? createTime : createTime.replace(' ', 'T'));
  if (!Number.isFinite(raw)) return false;
  return now - raw < hours * 3_600_000;
}
