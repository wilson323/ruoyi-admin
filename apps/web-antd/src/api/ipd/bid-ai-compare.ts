/**
 * 招投标 AI 对比接口（AI-P2-2 #3，后端 BidAiCompareController）。
 *
 * 真值：POST /api/v1/bid-invitations/{id}/ai-compare（2026-09-27 磁盘核实
 * BidAiCompareController.java + BidAiCompareService.java）。
 * 契约要点：
 * - 请求体 { responseIds }：参与对比的应标 id 列表，2~5 份（服务端去重后校验，
 *   <2 或 >5 为 PARAM_INVALID 400）；应标须同属该招标单，跨单即 404；
 * - 响应 CompareView：四维对照表（工期/资源/风险承诺/方案匹配度）+ 差异高亮
 *   + 模型/用量元信息；**仅展示不落库**，无任何决策字段——遴选决策恒人工
 *   （confirmToken 两阶段流 /pre-select-token + /select 与本端点零交集）；
 * - 权限：ipd:project:edit + requireLeaderOrAdmin（组长/超管；MARKET_PM/RD_PM 调用 403）；
 * - code=0 包络走 ipdPost；ID 一律字符串透传（禁 Number()，19 位雪花精度）。
 */
import { ipdPost } from './http';

/** 单维度对照行（cells key = 应标 id 字符串）。 */
export interface BidCompareDimensionRow {
  /** 应标 id → 该应标在此维度的表现（模型输出缺维即整体拒答，不会缺格）。 */
  cells: Record<string, string>;
  /** 本维度差异一句话。 */
  difference: string;
  /** 维度名（固定四选一：工期 / 资源 / 风险承诺 / 方案匹配度）。 */
  dimension: string;
}

/** POST /bid-invitations/{id}/ai-compare 响应（BidAiCompareService.CompareView；无决策字段）。 */
export interface BidAiCompareView {
  /** 四维对照表（缺维即后端拒答并报「AI 对比输出缺少维度」，前端不补半表）。 */
  dimensions: BidCompareDimensionRow[];
  /** 全局差异高亮（增强项，可为空表）。 */
  differences: string[];
  invitationId: string;
  invitationTitle: null | string;
  latencyMs: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** 参与对比的应标 id（字符串化，与 dimensions[].cells 键一致）。 */
  responseIds: string[];
}

/**
 * 遴选 AI 对比（只读分析，仅展示不落库；每次调用后端落一行 AI_BID_COMPARE 审计）。
 * 对应 BidAiCompareController#aiCompare — POST /api/v1/bid-invitations/{id}/ai-compare
 * responseIds 须 2~5 个不同应标 id（调用方先做数量闸，服务端二次校验 fail-closed）。
 */
export function runBidAiCompare(invitationId: string, responseIds: string[]): Promise<BidAiCompareView> {
  return ipdPost<BidAiCompareView>(`/bid-invitations/${encodeURIComponent(invitationId)}/ai-compare`, {
    responseIds,
  });
}
