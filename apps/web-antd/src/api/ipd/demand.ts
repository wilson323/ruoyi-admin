/**
 * 产品需求池 API（页40 需求管理；后端 DemandController /api/v1/demands）。
 *
 * 后端真值（G-04 以代码为准，2026-09-06 DemandController.java）：
 * - GET /demands?productId=&status= → { demands[], total }（无分页；ID 为 Long 字符串）；
 * - POST /demands/{id}/triage { status, marketPmId?, rdPmId? }（权限 ipd:product:edit）；
 * - POST /demands/{id}/link-project { projectId }（SUBMITTED/ACCEPTED 绑定后置 SCHEDULED）；
 * - status 值域（v3 TS-06）：SUBMITTED/ACCEPTED/EVALUATING/SCHEDULED/PROCESSING/CLOSED/ARCHIVED；
 * - source 值域：PORTAL_GUEST | INTERNAL。
 *
 * 原型对照（ZK-IPD RequirementsPage，G1 门禁 2026-09-06）：
 * - 状态展示名沿用原型词汇：SUBMITTED=新提交、EVALUATING=分析中、SCHEDULED=已规划；
 *   ACCEPTED/PROCESSING/CLOSED/ARCHIVED 为后端 v3 值域新增，按字面展示；
 * - 原型动作链 new→triaging→planned→link-project 映射为
 *   SUBMITTED/ACCEPTED→EVALUATING→SCHEDULED + link-project；
 * - 原型超管 window.prompt 型号匹配产品：后端无运行时绑定产品接口
 *   （productId 仅 GuestDemandService 提交时自动匹配），该交互不实现；
 * - 原型需求卡 attachments：后端 demands 无附件载荷，不展示。
 */
import { ipdGet, ipdPost } from './http';

export type DemandStatus =
  | 'ACCEPTED'
  | 'ARCHIVED'
  | 'CLOSED'
  | 'EVALUATING'
  | 'PROCESSING'
  | 'SCHEDULED'
  | 'SUBMITTED';

/** 需求池条目（DemandController.list 载荷；字段名与后端 LinkedHashMap 一致）。 */
export interface IpdDemand {
  createdAt: null | number | string;
  customerName: null | string;
  id: string;
  marketPmId: null | string;
  marketPmName: null | string;
  productId: null | string;
  productName: null | string;
  projectId: null | string;
  rdPmId: null | string;
  rdPmName: null | string;
  source: string;
  status: DemandStatus | string;
  submitterName: null | string;
  title: null | string;
}

export interface DemandListResult {
  demands: IpdDemand[];
  total: number;
}

/** 需求列表（productId/status 可选过滤）。 */
export function fetchDemands(query?: { productId?: string; status?: string }): Promise<DemandListResult> {
  return ipdGet<DemandListResult>('/demands', query);
}

/** 分流：设定状态（可同时分派双PM）。 */
export function triageDemand(
  id: string,
  body: { marketPmId?: string; rdPmId?: string; status: string },
): Promise<{ id: string; status: string }> {
  return ipdPost<{ id: string; status: string }>(`/demands/${encodeURIComponent(id)}/triage`, body);
}

/** 关联项目（绑定后 SUBMITTED/ACCEPTED 自动置 SCHEDULED）。 */
export function linkDemandProject(
  id: string,
  projectId: string,
): Promise<{ id: string; projectId: string; status: string }> {
  return ipdPost<{ id: string; projectId: string; status: string }>(
    `/demands/${encodeURIComponent(id)}/link-project`,
    { projectId },
  );
}
