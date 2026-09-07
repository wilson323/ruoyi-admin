/**
 * 项目组织绩效汇总与导出接口（原型 /reports 报表分析 / P4-4.1，AC-INC-34 / BR-INC-15）。
 *
 * 真值：IpdReportController（/api/v1/report/...，2026-09-06 磁盘核实）。
 * 已交付端点：GET /project-summary（month 必填，分页）、GET /export/allowance
 * （month，内部全员）、GET /export/bonus（projectId 必填，仅 GROUP_LEADER/SUPER_ADMIN，
 * 资金敏感）、GET /export/project（month）。
 *
 * 与原型 /api/analytics/process 不同构（逐条登记）：原型流程分析（一次质量通过率、
 * 审批退回率、招募周期、任务周期分布、流程事件流）后端无 analytics 端点，维持真缺口；
 * 后端已交付的是项目月度绩效汇总（津贴/奖金池/加权分）与三类台账导出。
 */
import { ipdGet } from './http';

/** 项目月度绩效汇总行（IpdReportController → ReportSummaryRow）。 */
export interface ReportSummaryRow {
  allowanceFinalAmount: null | number | string;
  allowanceRowCount: null | number;
  avgWeightedScore: null | number | string;
  bonusFinalPool: null | number | string;
  bonusRowCount: null | number;
  month: string;
  projectCode: string;
  projectId: string;
  projectName: string;
  scoreRowCount: null | number;
}

/** IPage 分页包络（与需求变更列表同构）。 */
export interface ReportSummaryPage {
  current: number;
  pages: number;
  records: ReportSummaryRow[];
  size: number;
  total: number;
}

/** 台账导出结果（结构化数据，不落文件流）。 */
export interface ReportExportResult {
  exportedAt: string;
  exportedBy: string;
  exportType: string;
  filters: Record<string, unknown>;
  headers: string[];
  rows: Record<string, unknown>[];
  totalCount: number;
}

export interface ReportSummaryQuery {
  keyword?: string;
  month: string;
  pageNo?: number;
  pageSize?: number;
  productId?: string;
}

/** 项目绩效汇总列表（month 必填 YYYY-MM）。 */
export function getProjectSummary(query: ReportSummaryQuery): Promise<ReportSummaryPage> {
  return ipdGet<ReportSummaryPage>('/report/project-summary', { ...query });
}

/** 津贴台账导出（AC-INC-34；内部全员，service 二次校验 actor 范围）。 */
export function exportAllowance(params: {
  month: string;
  personId?: string;
  projectId?: string;
}): Promise<ReportExportResult> {
  return ipdGet<ReportExportResult>('/report/export/allowance', params);
}

/** 奖金台账导出（仅 GROUP_LEADER/SUPER_ADMIN；projectId 必填）。 */
export function exportBonus(params: { projectId: string; status?: string }): Promise<ReportExportResult> {
  return ipdGet<ReportExportResult>('/report/export/bonus', params);
}

/** 项目汇总导出。 */
export function exportProjectSummary(params: {
  keyword?: string;
  month: string;
  productId?: string;
}): Promise<ReportExportResult> {
  return ipdGet<ReportExportResult>('/report/export/project', params);
}
