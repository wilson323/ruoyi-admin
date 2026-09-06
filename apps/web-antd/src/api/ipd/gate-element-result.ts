/**
 * Gate 要素判定结果接口（[CONSISTENCY-4] 2026-09-06 蜂群审计线1）。
 *
 * 真值：GateElementResultController（/api/v1/gates/{gateId}/element-results）。
 * 已交付端点：GET /elements（评审要素列表）、POST /element-results（提交逐项判定）、
 * POST /element-results/{resultId}/close（关闭带条件项）、POST /submit（提交评审结论）。
 *
 * 设计要点：
 * - 33 要素逐项打勾，命中「is_veto=1」项时前端通过按钮置灰（硬阻断）；
 * - 命中「条件通过」项必须填责任人与关闭期限（AC-GATE-16）；
 * - 提交评审结论前 33 项判定结果必须全提交（AC-GATE-15 否决项硬阻断）。
 *
 * 与 gate-panel.vue 配合使用：判定结果先行 → 然后 POST /submit 整体提交。
 */
import { ipdGet, ipdPost } from './http';

export type GateElementResult = 'FAIL' | 'PASS' | 'PASS_WITH_CONDITION';

/** 评审要素（与 GateElementResultController.GateElementView 对齐）。 */
export interface IpdGateElementView {
  code: string;
  description?: null | string;
  gateCode: 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
  id: string;
  isVeto: boolean;
  passStandard?: null | string;
  sortOrder: number;
  status: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  thresholdJson?: null | string;
  title: string;
}

/** 判定结果单条（前端逐项打勾后提交）。 */
export interface IpdGateElementResultReq {
  closeDeadline?: null | string;
  conditionNote?: null | string;
  elementId: string;
  responsiblePersonId?: null | string;
  result: GateElementResult;
}

export interface IpdGateElementResultView extends IpdGateElementResultReq {
  createTime?: null | string;
  id: string;
  operatorId: string;
}

/** 获取评审要素列表（含 33 项种子要素；后端按 gateId 透明过滤）。 */
export function listGateElements(gateId: string): Promise<IpdGateElementView[]> {
  return ipdGet<IpdGateElementView[]>(`/gates/${encodeURIComponent(gateId)}/elements`);
}

/** 提交单条要素判定（前端打勾后调用，可多次提交覆盖。 */
export function submitGateElementResult(gateId: string, req: IpdGateElementResultReq): Promise<IpdGateElementResultView> {
  return ipdPost<IpdGateElementResultView>(`/gates/${encodeURIComponent(gateId)}/element-results`, req);
}

/** 关闭带条件项（提供证据后关闭遗留项；AC-GATE-17）。 */
export function closeGateElementResult(gateId: string, resultId: string, evidence: { evidenceRef?: null | string; note?: null | string }): Promise<IpdGateElementResultView> {
  return ipdPost<IpdGateElementResultView>(
    `/gates/${encodeURIComponent(gateId)}/element-results/${encodeURIComponent(resultId)}/close`,
    evidence,
  );
}

/** 硬阻断检查：要素列表中 is_veto=true 且 result=FAIL 的条目数 > 0 ⇒ 提交按钮置灰。 */
export function countVetoFailures(elements: IpdGateElementView[], results: Map<string, GateElementResult>): number {
  return elements.filter((el) => el.isVeto && results.get(el.id) === 'FAIL').length;
}
