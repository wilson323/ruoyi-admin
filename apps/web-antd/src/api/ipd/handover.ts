/**
 * 项目移交与超管移交接口（页27 项目移交 / 原型 /handoffs + /admin 交接 / P2-7.1~7.3）。
 *
 * 真值：HandoverController（/api/v1/handovers，2026-09-11 R30 复核）、PmDirectoryController
 * （GET /pm-directory 在职人员目录）。已交付端点：POST /handovers（发起，onBehalf=true
 * 组长/超管代办一键完成）、POST /handovers/batch（批量，projectIds 空=名下该角色全部
 * 活跃项目）、POST /handovers/{id}/accept（DRAFT→COMPLETED 原子转移）、
 * POST /handovers/{id}/cancel（HIGH-3.1 撤销已接受移交：仅 COMPLETED 可撤、完成后 24h
 * 窗口、副作用反转，reason+confirmation 必填且 confirmation 须为固定短语）、
 * GET /handovers/inbox（待我接收+我发起的活记录 DRAFT/COMPLETED；ROLLED_BACK 终态
 * 不返回）、POST /handovers/super-admin（P2-7.3 超管移交，confirmation 确认短语）。
 *
 * 与原型 /api/handoffs 不同构（逐条登记）：原型 preview（未完成动作/资料/待决/AI 会话
 * 四卡 scope + approvals 责任确认链）、decision(approved/rejected)、
 * product-continuation、handoff-candidates 后端未交付；后端 accept 单动作即原子完成，
 * 可移交角色仅 MARKET_PM/RD_PM，接任人 personType 必须与 role 一致。
 */
import { ipdGet, ipdPost } from './http';

/** 可移交角色（HandoverService.HANDOVER_ROLES；接任人 personType 必须一致）。 */
export type HandoverRole = 'MARKET_PM' | 'RD_PM';

/** 移交记录（HandoverController.HandoverView；status: DRAFT | COMPLETED | ROLLED_BACK）。 */
export interface HandoverView {
  completedAt: null | string;
  confirmedAt: null | string;
  fromPersonId: string;
  handoverRole: string;
  id: string;
  note: null | string;
  projectId: string;
  /** 撤销原因/时间（仅 ROLLED_BACK 有值；Jackson 全局 NON_NULL，其余状态下不出现在 JSON）。 */
  rollbackAt?: null | string;
  rollbackReason?: null | string;
  status: string;
  toPersonId: string;
}

/** 批量移交逐项目结果（失败保持原归属；重试跳过已成功项）。 */
export interface HandoverBatchResult {
  projectId: string;
  reason: null | string;
  status: string;
}

/** 在职人员目录项（GET /pm-directory → directory[]）。 */
export interface PmDirectoryEntry {
  employeeNo: null | string;
  groupId: null | string;
  groupName: null | string;
  id: string;
  level: null | string;
  name: string;
  personType: string;
}

/** 收件箱：待我接收 + 我发起的（未完结）。 */
export function getHandoverInbox(): Promise<HandoverView[]> {
  return ipdGet<HandoverView[]>('/handovers/inbox');
}

/** 发起移交（onBehalf=true 需组长/超管，发起即完成）。 */
export function initiateHandover(input: {
  approvalRef?: string;
  note?: string;
  onBehalf?: boolean;
  projectId: string;
  role: HandoverRole;
  toPersonId: string;
}): Promise<HandoverView> {
  return ipdPost<HandoverView>('/handovers', input);
}

/** 批量移交（projectIds 为空 ⇒ 原负责人名下该角色全部活跃项目）。 */
export function batchHandover(input: {
  approvalRef?: string;
  fromPersonId: string;
  note?: string;
  projectIds?: string[];
  role: HandoverRole;
  toPersonId: string;
}): Promise<HandoverBatchResult[]> {
  return ipdPost<HandoverBatchResult[]>('/handovers/batch', input);
}

/** 接手人确认接受（DRAFT → COMPLETED，原子转移；approvalRef 仅达上限阈值时必填）。 */
export function acceptHandover(id: string, approvalRef?: string): Promise<HandoverView> {
  return ipdPost<HandoverView>(`/handovers/${id}/accept`, approvalRef ? { approvalRef } : {});
}

/** P2-7.3 超管权限移交（AC-HAND-07）：confirmation 固定短语二次确认。 */
export function transferSuperAdmin(input: {
  confirmation: string;
  note?: string;
  toPersonId: string;
}): Promise<void> {
  return ipdPost<void>('/handovers/super-admin', input);
}

/**
 * HIGH-3.1 撤销确认短语（HandoverController.cancel 硬编码比对，不匹配报 PARAM_INVALID）。
 */
export const HANDOVER_CANCEL_CONFIRM_PHRASE = '确认撤销该移交';

/**
 * 撤销已接受的移交（HIGH-3.1：COMPLETED → ROLLED_BACK，完成后 24h 内；
 * 副作用反转：接手人退出 + 发起人绑定复位；权限=发起人/接手人/项目组长/超管，后端校验）。
 */
export function cancelHandover(
  id: string,
  input: { confirmation: string; reason: string },
): Promise<HandoverView> {
  return ipdPost<HandoverView>(`/handovers/${id}/cancel`, input);
}

/** 在职人员目录（发起移交的接任人候选）。 */
export function getPmDirectory(): Promise<{ directory: PmDirectoryEntry[]; total: number }> {
  return ipdGet<{ directory: PmDirectoryEntry[]; total: number }>('/pm-directory');
}
