/**
 * 删除审核域 API（P0-6.x）：两级审核 + 撤回 + 归档区 + 我的申请 + 待我审核。
 *
 * 端点均挂在 /api/v1/deletion-requests（前缀由 requestIpd 统一补齐）：
 * - 决策端点（leader-decision / admin-decision）的 approve/opinion 是查询参数，无请求体；
 * - P1-1（R25 真白屏修复）：新增「我的申请 / 待我审核」列表查询端点
 *   （my-requests / review-queue），页面不再手填申请编号；
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

/** DELETION_STATUS_TEXT 已迁出至 _shared/ipd-enums.DELETION_STATUS_TEXT（与 _shared/ipd-state-machines.DELETION_STATUS_MACHINE
 *  的 6 态不同，前端展示按此 5 态），消费方请从 @/views/ipd/_shared/ipd-enums 导入。 */

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

/**
 * P1-1（R25 真白屏修复）：「我的申请」列表。
 * <p>GET /api/v1/deletion-requests/my-requests —— 当前会话人作为申请人发起的全部删除申请
 * （含 LEADER_REVIEW / ADMIN_REVIEW / REJECTED / WITHDRAWN / DELETED 全状态，按创建时间倒序）。
 * 服务端基于 actor.id() 权威过滤，前端不再手填申请 ID。
 *
 * @returns 我的申请列表（可能为空）
 */
export function listMyDeletionRequests(): Promise<DeletionRequest[]> {
  return ipdGet('/deletion-requests/my-requests');
}

/**
 * P1-1（R25 真白屏修复）：「待我审核」列表。
 * <p>GET /api/v1/deletion-requests/review-queue —— 服务端按当前会话人角色分流：
 * <ul>
 *   <li>组长 (GROUP_LEADER) → 待初审申请（LEADER_REVIEW）</li>
 *   <li>超管 (SUPER_ADMIN) → 待终审申请（ADMIN_REVIEW）</li>
 *   <li>其他内部角色 → 空集</li>
 * </ul>
 *
 * @returns 待我审核列表（可能为空）
 */
export function listDeletionReviewQueue(): Promise<DeletionRequest[]> {
  return ipdGet('/deletion-requests/review-queue');
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
