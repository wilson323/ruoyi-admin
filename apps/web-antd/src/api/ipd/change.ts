/**
 * 变更单接口（页25 项目详情-需求与变更 / 页26 变更单详情 / 原型 /changes 变更管理页）。
 *
 * 真值：CoefficientChangeController（S/B 级系数定值，AC-INC-15c）与
 * LaunchDateChangeController（上市日期双签，AC-INC-33 / P1-2.2）、
 * RequirementChangeController（需求变更双签否决，P2-6.1，BR-GATE-07）。
 * 已交付端点：系数/上市日期两类各自的「发起」与「决策」共 4 个 POST，无 GET 列表/详情
 * （列表与详情读取区由项目详情 changes 页签挂占位，G-06）。
 * 需求变更 6 端点已交付（2026-09-06 磁盘核实，旧头注「仅 domain 类」作废）：
 * POST /requirement-changes、PUT /{id}/submit、PUT /{id}/sign、GET /{id}、
 * GET /requirement-changes?pageNo&pageSize&projectId&status、GET /requirement-changes/open。
 */
import { IpdRequestError } from './auth';
import { normalizeDateTime } from './ai-document';
import { ipdGet, ipdPost, ipdPut } from './http';

export type ChangeType = 'coefficient' | 'launch-date';

/** S/B 级差异化系数定值申请（PENDING_LEADER → CONFIRMED/REJECTED）。 */
export interface CoefficientChangeRequest {
  createTime: null | string;
  id: string;
  leaderDecision: null | string;
  leaderDecidedAt: null | string;
  leaderId: null | string;
  leaderOpinion: null | string;
  /** BigDecimal 原样保留（string | number），展示统一走 formatMoney/formatPercent。 */
  proposedCoefficient: null | number | string;
  reason: null | string;
  status: string;
}

/** 上市日期双签申请（PENDING_SECOND → CONFIRMED/REJECTED）。 */
export interface LaunchDateChangeRequest {
  confirmerId: null | string;
  confirmerRole: null | string;
  confirmedAt: null | string;
  createTime: null | string;
  /** APPROVE | REJECT */
  decision: null | string;
  id: string;
  opinion: null | string;
  previousLaunchDate: null | string;
  proposedLaunchDate: null | string;
  proposerId: null | string;
  proposerRole: null | string;
  reason: null | string;
  status: string;
  version: null | number;
}

/** 发起系数变更入参（CoefficientChangeController.ProposeReq）。 */
export interface CoefficientChangeProposeInput {
  marketPmId: string;
  /** 十进制字符串（来自 InputNumber 的 toString），避免浮点误差。 */
  proposedCoefficient: string;
  rdPmId: string;
  projectId: string;
  reason: string;
}

/** 发起上市日期变更入参（LaunchDateChangeController.ProposeReq）。 */
export interface LaunchDateChangeProposeInput {
  /** yyyy-MM-dd（DatePicker valueFormat 保证）。 */
  proposedLaunchDate: string;
  projectId: string;
  reason: string;
}

const isIdString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value);

const parseDate = (value: unknown): null | string =>
  typeof value === 'string' ? normalizeDateTime(value) : null;

/** 收敛为前端契约；格式异常直接拒绝，不做静默修补。 */
export function parseCoefficientChangeRequest(data: unknown): CoefficientChangeRequest {
  const record = data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
  if (
    !record ||
    !isIdString(record.id) ||
    !isIdString(record.projectId) ||
    typeof record.status !== 'string'
  ) {
    throw new IpdRequestError('变更单数据格式异常，请稍后重试');
  }
  return {
    createTime: parseDate(record.createTime),
    id: record.id,
    leaderDecision: typeof record.leaderDecision === 'string' ? record.leaderDecision : null,
    leaderDecidedAt: parseDate(record.leaderDecidedAt),
    leaderId: isIdString(record.leaderId) ? record.leaderId : null,
    leaderOpinion: typeof record.leaderOpinion === 'string' ? record.leaderOpinion : null,
    proposedCoefficient: typeof record.proposedCoefficient === 'number' || typeof record.proposedCoefficient === 'string'
      ? record.proposedCoefficient
      : null,
    reason: typeof record.reason === 'string' ? record.reason : null,
    status: record.status,
  };
}

/** 收敛为前端契约；格式异常直接拒绝，不做静默修补。 */
export function parseLaunchDateChangeRequest(data: unknown): LaunchDateChangeRequest {
  const record = data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
  if (
    !record ||
    !isIdString(record.id) ||
    !isIdString(record.projectId) ||
    typeof record.status !== 'string'
  ) {
    throw new IpdRequestError('变更单数据格式异常，请稍后重试');
  }
  return {
    confirmerId: isIdString(record.confirmerId) ? record.confirmerId : null,
    confirmerRole: typeof record.confirmerRole === 'string' ? record.confirmerRole : null,
    confirmedAt: parseDate(record.confirmedAt),
    createTime: parseDate(record.createTime),
    decision: typeof record.decision === 'string' ? record.decision : null,
    id: record.id,
    opinion: typeof record.opinion === 'string' ? record.opinion : null,
    previousLaunchDate: parseDate(record.previousLaunchDate),
    proposedLaunchDate: parseDate(record.proposedLaunchDate),
    proposerId: isIdString(record.proposerId) ? record.proposerId : null,
    proposerRole: typeof record.proposerRole === 'string' ? record.proposerRole : null,
    reason: typeof record.reason === 'string' ? record.reason : null,
    status: record.status,
    version: typeof record.version === 'number' ? record.version : null,
  };
}

/** 双PM 联合提议系数变更 → 待产品组长确认。 */
export async function proposeCoefficientChange(input: CoefficientChangeProposeInput): Promise<CoefficientChangeRequest> {
  return parseCoefficientChangeRequest(await ipdPost('/coefficient-change-requests', {
    marketPmId: input.marketPmId,
    proposedCoefficient: input.proposedCoefficient,
    rdPmId: input.rdPmId,
    projectId: input.projectId,
    reason: input.reason,
  }));
}

/** 产品组长确认或驳回（approve 用 @RequestParam，走查询串）。 */
export async function decideCoefficientChange(
  requestId: string,
  approve: boolean,
  opinion?: null | string,
): Promise<CoefficientChangeRequest> {
  return parseCoefficientChangeRequest(await ipdPost(
    `/coefficient-change-requests/${requestId}/leader-decision?approve=${approve ? 'true' : 'false'}${opinion ? `&opinion=${encodeURIComponent(opinion)}` : ''}`,
  ));
}

/** 上市日期变更第一签提议 → 待对方（另一侧PM）确认。 */
export async function proposeLaunchDateChange(input: LaunchDateChangeProposeInput): Promise<LaunchDateChangeRequest> {
  return parseLaunchDateChangeRequest(await ipdPost('/launch-date-change-requests', {
    proposedLaunchDate: input.proposedLaunchDate,
    projectId: input.projectId,
    reason: input.reason,
  }));
}

/** 上市日期变更第二签确认或驳回（approve 用 @RequestParam，走查询串）。 */
export async function decideLaunchDateChange(
  requestId: string,
  approve: boolean,
  opinion?: null | string,
): Promise<LaunchDateChangeRequest> {
  return parseLaunchDateChangeRequest(await ipdPost(
    `/launch-date-change-requests/${requestId}/second-decision?approve=${approve ? 'true' : 'false'}${opinion ? `&opinion=${encodeURIComponent(opinion)}` : ''}`,
  ));
}

// ---------- 需求变更单（P2-6.1 双签否决；原型 /changes 页挂本段） ----------

/** 状态机 DRAFT → PENDING_SIGN → APPROVED/REJECTED（单方 REJECT 即整体否决）。 */
export type RequirementChangeStatus = 'APPROVED' | 'DRAFT' | 'PENDING_SIGN' | 'REJECTED' | string;

export interface RequirementChange {
  afterSnapshot: null | string;
  beforeSnapshot: null | string;
  changeType: null | string;
  createBy?: null | string;
  createTime: null | string;
  id: string;
  projectId: null | string;
  reason: null | string;
  requirementId: null | string;
  signatures: null | string;
  status: RequirementChangeStatus;
  updateTime?: null | string;
}

export interface RequirementChangePage {
  records: RequirementChange[];
  total: number;
}

export interface RequirementChangeCreateInput {
  /** 影响评估快照 JSON（范围/成本/时限/质量四维度）；提交双签前必须非空。 */
  afterSnapshot?: null | string;
  beforeSnapshot?: null | string;
  changeType: string;
  /** 缺省时服务端从关联需求带出。 */
  projectId?: null | string;
  reason: string;
  requirementId: string;
}

function parseRequirementChange(raw: unknown): RequirementChange {
  const record = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!record || !isIdString(record.id)) {
    throw new IpdRequestError('变更单数据格式异常，请稍后重试');
  }
  const nullableString = (value: unknown): null | string =>
    value === undefined || value === null ? null : String(value);
  return {
    afterSnapshot: nullableString(record.afterSnapshot),
    beforeSnapshot: nullableString(record.beforeSnapshot),
    changeType: nullableString(record.changeType),
    createBy: nullableString(record.createBy),
    createTime: parseDate(record.createTime),
    id: record.id,
    projectId: nullableString(record.projectId),
    reason: nullableString(record.reason),
    requirementId: nullableString(record.requirementId),
    signatures: nullableString(record.signatures),
    status: typeof record.status === 'string' ? record.status : '',
    updateTime: nullableString(record.updateTime),
  };
}

/** 项目变更单分页（IPage：records/total）。 */
export async function listRequirementChanges(
  projectId: string,
  status?: string,
): Promise<RequirementChangePage> {
  const raw = await ipdGet<unknown>('/requirement-changes', {
    pageNo: 1,
    pageSize: 50,
    projectId,
    ...(status ? { status } : {}),
  });
  const record = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(record.records) ? record.records : [];
  return {
    records: rows.map((row) => parseRequirementChange(row)),
    total: typeof record.total === 'number' ? record.total : rows.length,
  };
}

/** 创建变更单草稿（市场PM/研发PM；权限 OPERATION_MODULE_PROJECT_STATUS_CHANGE）。 */
export async function createRequirementChange(
  input: RequirementChangeCreateInput,
): Promise<RequirementChange> {
  return parseRequirementChange(await ipdPost('/requirement-changes', {
    afterSnapshot: input.afterSnapshot ?? null,
    beforeSnapshot: input.beforeSnapshot ?? null,
    changeType: input.changeType,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    reason: input.reason,
    requirementId: input.requirementId,
  }));
}

/** 提交双签（DRAFT ⇒ PENDING_SIGN；前后快照必须非空，服务端校验）。 */
export async function submitRequirementChange(id: string): Promise<RequirementChange> {
  return parseRequirementChange(await ipdPut(`/requirement-changes/${encodeURIComponent(id)}/submit`));
}

/** 双签签署（decision=APPROVE|REJECT；仅 MARKET_PM/RD_PM，服务端校验）。 */
export async function signRequirementChange(
  id: string,
  decision: 'APPROVE' | 'REJECT',
  opinion?: null | string,
): Promise<RequirementChange> {
  const query = `decision=${decision}${opinion ? `&opinion=${encodeURIComponent(opinion)}` : ''}`;
  return parseRequirementChange(
    await ipdPut(`/requirement-changes/${encodeURIComponent(id)}/sign?${query}`),
  );
}

/** 变更单详情（GET /requirement-changes/{id}；卡 P0-10.25 真实现配套）。 */
export async function getRequirementChange(id: string): Promise<RequirementChange> {
  return parseRequirementChange(
    await ipdGet<unknown>(`/requirement-changes/${encodeURIComponent(id)}`),
  );
}
