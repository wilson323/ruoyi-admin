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
  /** S/A/B 差异化系数（后端从项目 levelCoefficient 带出，前端不传）。 */
  coefficient: null | number | string;
  contributionMarketMin?: null | number | string;
  contributionRdMax?: null | number | string;
  calculatedAt?: null | string;
  createTime?: null | string;
  finalPool: null | number | string;
  id: string;
  poolRate: null | number | string;
  projectId: string;
  status: BonusStatus;
  /** DRAFT 行的实际回款（后端 compute 将 actualReceipts 写入 targetSales 列）。 */
  targetSales?: null | number | string;
  tierCoefficient: null | number | string;
}

/**
 * 计算入参（后端 ComputeBonusPoolReq 真值）：
 * - actualReceipts 必填（≥0）；
 * - achievementRate 销售/回款达成率百分数（如 100 = 100%），可空 → 后端中性 1.0 并按 6 档阶梯查 tierCoefficient；
 * - personalCoefficient 个人绩效系数，可空 → 1.0；
 * - poolRate 小数 (0, 1]，可空 → 后端 ZK 默认 0.05；S/A/B levelCoefficient 由后端从项目配置带出。
 */
export interface ComputeBonusPoolReq {
  achievementRate?: number | string;
  actualReceipts: number | string;
  personalCoefficient?: number | string;
  poolRate?: number | string;
  projectId: string;
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

/* ========== ORPHAN-A4 增量接线（R212 桶表 #10-12；看板卡 ac46043e；2026-09-25） ========== */

/** MyBatis-Plus IPage 分页包络（BonusPoolController#page；与 bid.ts IpdPage 同构，本地声明避免跨域 import）。 */
export interface BonusPoolPage {
  current: number;
  pages: number;
  records: BonusPool[];
  size: number;
  total: number;
}

/**
 * 分页查询奖金池（GET /bonus-pool/page；PERF-P0-2 替代全量 /list）。
 * pageSize 默认 20、上限 200（后端 Math.min 兜底）；排序 calculatedAt DESC。
 */
export function pageBonusPools(projectId: string, pageNo = 1, pageSize = 20): Promise<BonusPoolPage> {
  return ipdGet<BonusPoolPage>('/bonus-pool/page', { projectId, pageNo, pageSize });
}

/**
 * 自动核算入参（后端 AutoComputeBonusPoolReq 真值）：
 * - period 必填 YYYY-MM（服务端据 kpi_records 当月 comprehensive_score 推导 personalCoefficient，
 *   前端不传 personalCoefficient）；
 * - 其余字段语义同 ComputeBonusPoolReq。
 */
export interface AutoComputeBonusPoolReq {
  achievementRate?: number | string;
  actualReceipts: number | string;
  period: string;
  poolRate?: number | string;
  projectId: string;
}

/**
 * 自动核算（POST /bonus-pool/auto-compute；SEC-FIX-HIGH-5.2）。
 * 权限 ipd:bonus-pool:compute + 后端 requireAdmin 兜底 → 实际仅超管（R215-N1 口径）；
 * 组长持码调用会 403（后端兜底，前端码闸不放开）。
 */
export function autoComputeBonusPool(req: AutoComputeBonusPoolReq): Promise<BonusPool> {
  return ipdPost<BonusPool>('/bonus-pool/auto-compute', req);
}

/** 绩效系数取数策略（后端 PreviewCoefficientReq.strategy；空 = 走 system_configs bonus.performance.strategy）。 */
export type CoefficientStrategy = 'LAST_QUARTER' | 'PROJECT_SCORE' | 'WEIGHTED_AVG';

/** 系数试算入参（后端 PreviewCoefficientReq：score 综合得分 [0,100] 必填；projectId 预留多项目叠加）。 */
export interface PreviewCoefficientReq {
  projectId: string;
  score: number | string;
  strategy?: CoefficientStrategy;
}

/**
 * 绩效系数试算（POST /bonus-pool/coefficient/preview；P3-4.5 AC-INC-22/23/24）。
 * 仅查表/计算，不写 audit_log、不 insert bonus_pools；权限同 compute（仅超管）。
 */
export function previewBonusCoefficient(req: PreviewCoefficientReq): Promise<BonusPool> {
  return ipdPost<BonusPool>('/bonus-pool/coefficient/preview', req);
}
