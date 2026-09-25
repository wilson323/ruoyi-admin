/**
 * 关键 Gate 双签评审接口（页23 阶段确认-五大关键联合 Gate / P2-5.2、P2-5.4）。
 *
 * 真值：GateReviewController（/api/v1/gates/{gateId}/...，2026-09-06 磁盘核实）。
 * 已交付端点：GET /review（双签盲签视图，AC-GATE-03/04）、POST /sign（每方每轮一条，
 * 任一 REJECT ⇒ Gate REJECTED，AC-GATE-05）、POST /reopen（round+1，AC-GATE-06/07）、
 * POST /extend-deadline（仅超管，最多 3 次，AC-GATE-21）、POST /arbitrate（组长仲裁，
 * AC-GATE-10 中段）、POST /final-ruling（超管终裁，AC-GATE-10 尾段）。
 * R212 ORPHAN-A1 补齐（2026-09-24）：GET /observers（列席人+意见，仅组长/超管）、
 * POST /observers/invite（邀约列席，仅超管/组长）、POST /observers/{observerId}/opinion
 * （列席意见，仅本人；MEDIUM-1.3 列席 3 端点，看板 a5bb3e68 后端已交付）。
 *
 * R30 生产就绪补齐（2026-09-11）：GET /projects/{projectId}/gates（ProjectController）
 * 项目维度 Gate 列表已交付，前端不再依赖手输 Gate 编号。
 * 与原型 /api/key-gates 的剩余差异（逐条登记）：材料归档（FormData）与五节点顺序签署链
 * 后端未交付，维持真缺口登记，不造假数据。
 */
import { ipdGet, ipdPost } from './http';

/** 签署/仲裁/终裁决策值（GateReviewController.SignRequest#decision）。 */
export type GateDecision = 'APPROVE' | 'REJECT';

/** 后端 Date 序列化形态：真库实测为毫秒时间戳（如 1789388463000），ISO 字符串为兼容形态。 */
export type IpdDateValue = null | number | string;

/** Gate 状态（GateReviewService 常量，ABSTAINED_TIMEOUT 为超时弃权终态）。 */
export type GateStatus = 'ABSTAINED_TIMEOUT' | 'APPROVED' | 'PENDING' | 'REJECTED';

/** 单方签署行（GateReviewService#rowView；未揭示时不含 decision/opinion）。 */
export interface GateReviewRow {
  decision?: string;
  opinion?: string;
  reviewerType: string;
  signedAt: IpdDateValue;
}

/** GET /review 双签视图（在途互盲：对方仅 otherSubmitted 标志；终态/超管全揭示）。 */
export interface GateReviewView {
  dualSign: boolean;
  extensionCount: null | number;
  gateCode: string;
  gateId: string;
  /** 对方已提交但未揭示时追加（AC-GATE-03）。 */
  hint?: string;
  /** 当前人自己的签署行（总可见，可能为 null）。 */
  my: null | GateReviewRow;
  /** 揭示后（终态或超管）的对方签署行。 */
  other: null | GateReviewRow;
  otherSubmitted: boolean;
  /** 第 3 轮起双方产品组长自动列席（AC-GATE-07）。 */
  observers?: { id: string; name: string }[];
  leadSide: string;
  round: number;
  signDueAt: IpdDateValue;
  status: GateStatus;
}

/** 仲裁/终裁行视图（GateReviewController.ArbitrationView）。 */
export interface GateArbitrationView {
  arbitratorId: string;
  arbitratorType: string;
  decision: string;
  gateId: string;
  id: string;
  opinion: null | string;
  round: null | number;
}

/** POST /reopen 响应（round+1 后的新期限）。 */
export interface GateReopenResult {
  id: string;
  round: number;
  signDueAt: number | string;
  status: string;
}

/** POST /extend-deadline 响应（AC-GATE-21 展示锚点）。 */
export interface GateExtendResult {
  extensionCount: number;
  id: string;
  signDueAt: number | string;
  status: string;
}

/** Gate 实例行（ProjectController GET /projects/{id}/gates；gates 表，id 降序）。 */
export interface ProjectGateItem {
  concludedAt?: IpdDateValue;
  currentRound?: null | number;
  gateCode?: null | string;
  id: string;
  plannedAt?: IpdDateValue;
  projectId: string;
  signDueAt?: IpdDateValue;
  startedAt?: IpdDateValue;
  status: GateStatus | string;
}

/** 项目维度 Gate 列表（R30 补齐；空列表 = 尚无 Gate，真实空态）。 */
export function listProjectGates(projectId: string): Promise<ProjectGateItem[]> {
  return ipdGet<ProjectGateItem[]>(`/projects/${encodeURIComponent(projectId)}/gates`);
}

/** 双签视图（AC-GATE-03 互盲 / AC-GATE-04 终态揭示）。 */
export function getGateReview(gateId: string): Promise<GateReviewView> {
  return ipdGet<GateReviewView>(`/gates/${gateId}/review`);
}

/** 签署：每方每轮一条（重复拒）；任一 REJECT ⇒ Gate REJECTED（AC-GATE-05）。 */
export function signGate(
  gateId: string,
  decision: GateDecision,
  opinion?: string,
): Promise<GateReviewRow> {
  return ipdPost<GateReviewRow>(`/gates/${gateId}/sign`, { decision, opinion });
}

/** 否决后重新发起：round+1；第 3 轮起组长列席/第 5 轮起超管介入（AC-GATE-06/07）。 */
export function reopenGate(gateId: string): Promise<GateReopenResult> {
  return ipdPost<GateReopenResult>(`/gates/${gateId}/reopen`, {});
}

/** 超管延长签署期限，最多 3 次（AC-GATE-21）。 */
export function extendGateDeadline(gateId: string, days: number): Promise<GateExtendResult> {
  return ipdPost<GateExtendResult>(`/gates/${gateId}/extend-deadline`, { days });
}

/** 组长仲裁意见（AC-GATE-10 中段）。 */
export function arbitrateGate(
  gateId: string,
  decision: GateDecision,
  opinion?: string,
): Promise<GateArbitrationView> {
  return ipdPost<GateArbitrationView>(`/gates/${gateId}/arbitrate`, { decision, opinion });
}

/** 超管终裁（AC-GATE-10 尾段），结果写入项目审计日志。 */
export function finalRulingGate(
  gateId: string,
  decision: GateDecision,
  opinion?: string,
): Promise<GateArbitrationView> {
  return ipdPost<GateArbitrationView>(`/gates/${gateId}/final-ruling`, { decision, opinion });
}

/* ---------- R212 ORPHAN-A1（2026-09-24）：MEDIUM-1.3 列席 3 端点接线 ---------- */

/** 列席角色（GateReviewService.OBSERVER_ROLES 白名单：销售/供应/售后/品质/合规）。 */
export type GateObserverRole = 'AFTERSALES' | 'COMPLIANCE' | 'QUALITY' | 'SALES' | 'SUPPLY';

/** 列席角色下拉选项（与后端白名单一一对应，禁臆造值）。 */
export const GATE_OBSERVER_ROLE_OPTIONS: ReadonlyArray<{ label: string; value: GateObserverRole }> = Object.freeze([
  { label: '销售', value: 'SALES' },
  { label: '供应', value: 'SUPPLY' },
  { label: '售后', value: 'AFTERSALES' },
  { label: '品质', value: 'QUALITY' },
  { label: '合规', value: 'COMPLIANCE' },
]);

/** 列席人行视图（GateReviewController.ObserverView：字符串 ID 契约）。 */
export interface GateObserverView {
  /** 是否已出席（0/1，未出席为 null）。 */
  attended: null | number;
  gateId: string;
  /** 观察行 id（区别于 observerId）。 */
  id: string;
  invitedAt: IpdDateValue;
  /** 列席人意见（未提交为 null；仅本人可写，不入主审投票）。 */
  opinion: null | string;
  /** 列席人 personId（意见提交的本人匹配键）。 */
  observerId: string;
  /** 列席角色（SALES/SUPPLY/AFTERSALES/QUALITY/COMPLIANCE）。 */
  role: GateObserverRole | string;
}

/** POST /observers/invite 响应（后端 Map.of(gateId, role, invitedCount)）。 */
export interface GateObserverInviteResult {
  gateId: string;
  invitedCount: number;
  role: string;
}

/** 查 Gate 列席人员 + 意见（GET /observers；后端仅组长/超管放行，其余 400 拒绝）。 */
export function listGateObservers(gateId: string): Promise<GateObserverView[]> {
  return ipdGet<GateObserverView[]>(`/gates/${encodeURIComponent(gateId)}/observers`);
}

/**
 * 邀约列席人员（POST /observers/invite；仅超管/产品组长）。
 * 后端 body 契约：observerIds 为 personId 列表（Long），字符串透传（Jackson 宽松转换
 * string→Long），防 19 位雪花数字转换精度损失；
 * 同 gate+observer 唯一约束兜底幂等（重复邀请不报错）。
 */
export function inviteGateObservers(
  gateId: string,
  observerIds: string[],
  role: GateObserverRole,
): Promise<GateObserverInviteResult> {
  return ipdPost<GateObserverInviteResult>(`/gates/${encodeURIComponent(gateId)}/observers/invite`, {
    observerIds,
    role,
  });
}

/** 列席人提交意见（POST /observers/{observerId}/opinion；仅 observer 本人，1~2000 字）。 */
export function submitGateObserverOpinion(
  gateId: string,
  observerId: string,
  opinion: string,
): Promise<GateObserverView> {
  return ipdPost<GateObserverView>(
    `/gates/${encodeURIComponent(gateId)}/observers/${encodeURIComponent(observerId)}/opinion`,
    { opinion },
  );
}
