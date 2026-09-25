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

/**
 * —— R215 WP3.1 批次（ORPHAN-A8，卡 786da825）增补：移交域补端点 2 条 ——
 *
 * 真值：HandoverController（R-NEW-B-1 收口批交付，2026-09-24 R212 分桶表 #24/#26）：
 * - POST /handovers/{id}/archive（AC-HAND-05）：归档已 COMPLETED 的移交，写 archived_at +
 *   审计快照，不删记录、不反转责任；幂等（重复归档直接返回原记录）；权限=移交双方/
 *   项目主组组长/超管（Service 内对象级判定，前端不做可见性之外的门控）。
 * - GET /handovers/monthly-attribution?projectId&month（AC-HAND-08）：按月在任 PM 归属；
 *   month 格式 yyyy-MM（Service 校验，非法抛业务异常）；权限=项目在职成员或超管
 *   （IpdIdorGuard.requireProjectMemberOrSuperAdmin，跨组不可读）。
 * 注：HandoverView 不输出 archivedAt 字段，归档态对收件箱不可见（inbox 白名单
 * DRAFT/COMPLETED 不过滤 archived），前端按幂等语义处理（重复点击不报错）。
 *
 * live 实测（2026-09-25 dev，经 vite 代理 15666，超管凭据）：
 * - 对 DRAFT 记录 archive / 不存在 id archive 均返回 400/10001（ServiceException 走
 *   PARAM_INVALID，message 携带精确原因「仅 COMPLETED 移交可归档（当前 DRAFT）」），非 50002；
 * - monthly-attribution month 格式非法同为 400/10001（非 50010）；不存在项目返回
 *   200 + 空数组（宽容语义，不 404）；跨组越权 403/30001「非项目成员，无权访问」；
 * - COMPLETED 归档正向 200 因 dev 库造数路径全被业务守卫封死（onBehalf/batch 仅限
 *   离职冻结人员、accept 仅接手人本人）未做 live，行为由契约测试锁定。
 */

/** AC-HAND-08 归属行（HandoverController.AttributionRow；personId 后端已字符串化，daysInRole 为 int）。 */
export interface HandoverAttributionRow {
  daysInRole: number;
  fromDate: null | string;
  personId: string;
  personName: string;
  role: string;
  source: string;
  toDate: null | string;
}

/** AC-HAND-05：归档已 COMPLETED 的移交（幂等；权限后端校验：移交双方/项目组长/超管）。 */
export function archiveHandover(id: string): Promise<HandoverView> {
  return ipdPost<HandoverView>(`/handovers/${id}/archive`);
}

/** AC-HAND-08：按月在任 PM 归属查询（month=yyyy-MM；仅项目在职成员/超管，后端守卫）。 */
export function getMonthlyAttribution(
  projectId: string,
  month: string,
): Promise<HandoverAttributionRow[]> {
  return ipdGet<HandoverAttributionRow[]>('/handovers/monthly-attribution', { projectId, month });
}
