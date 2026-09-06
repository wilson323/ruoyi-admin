/**
 * 奖金池接口（页34 奖金池核算；P3-4.2/4.3/4.4/4.5；AC-INC-16~24/35）。
 *
 * 真值：BonusPoolController（/api/v1/bonus-pool/...）。
 * 口径：基数 = 实际回款 × 5% × S/A/B（2026-09-06 owner 裁决 [CONSISTENCY-1]）。
 *
 * 已交付端点：POST /compute（DRAFT 入库）、POST /{id}/freeze（DRAFT→CONFIRMED）、
 * POST /{id}/distribute（CONFIRMED→DISTRIBUTED，生成内部台账）、GET /{id}、GET /list?projectId=&status=。
 */
import { ipdGet, ipdPost } from './http';

export type BonusStatus = 'DRAFT' | 'CONFIRMED' | 'DISTRIBUTED';

export interface BonusPool {
  achievementRate: null | number | string;
  basePool: null | number | string;
  coefficient: null | number | string;
  contributionMarketMin?: null | number | string;
  contributionRdMax?: null | number | string;
  createTime?: null | string;
  finalPool: null | number | string;
  id: string;
  levelCoefficient: null | number | string;
  period: null | string;
  poolRate: null | number | string;
  projectId: string;
  projectLevel: 'A' | 'B' | 'S' | null | string;
  receiptAmounts?: null | number | string;
  status: BonusStatus;
  targetSales?: null | number | string;
  tierCoefficient: null | number | string;
}

export interface ComputeBonusPoolReq {
  achievementRate: number | string;
  levelCoefficient?: number | string;
  period: string;
  poolRate?: number | string;
  projectId: string;
  receiptAmounts: number | string;
  tierCoefficient?: number | string;
}

/** 触发计算并落库 DRAFT。 */
export function computeBonusPool(req: ComputeBonusPoolReq): Promise<BonusPool> {
  return ipdPost<BonusPool>('/bonus-pool/compute', req);
}

/** DRAFT → CONFIRMED（幂等；权限 ipd:bonus-pool:compute）。 */
export function freezeBonusPool(id: string): Promise<BonusPool> {
  return ipdPost<BonusPool>(`/bonus-pool/${encodeURIComponent(id)}/freeze`);
}

/** CONFIRMED → DISTRIBUTED（生成内部台账；不接财务系统）。 */
export function distributeBonusPool(id: string): Promise<BonusPool> {
  return ipdPost<BonusPool>(`/bonus-pool/${encodeURIComponent(id)}/distribute`);
}

/** 查询奖金池详情。 */
export function getBonusPool(id: string): Promise<BonusPool> {
  return ipdGet<BonusPool>(`/bonus-pool/${encodeURIComponent(id)}`);
}

/** 列表：按项目 + 状态过滤。 */
export function listBonusPools(projectId: string, status?: BonusStatus): Promise<BonusPool[]> {
  return ipdGet<BonusPool[]>('/bonus-pool/list', status ? { projectId, status } : { projectId });
}
