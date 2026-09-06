/**
 * KPI 考核接口（页29 KPI 考核 / 原型 /performance 项目KPI / P3-1.1~1.3）。
 *
 * 真值：KpiRecordController（/api/v1/kpi/...，2026-09-06 磁盘核实，权限 ipd:kpi:query）。
 * 已交付端点：GET /functional?period（功能 KPI 指标来源与加权贡献，P0-10.29）、
 * GET /performance?period（绩效 KPI 聚合：L1..L5 津贴分档合计 + COMPREHENSIVE
 * 项目加权分经奖金池阶梯系数映射 ×100，P0-10.30）、GET /trend?periods（历史趋势，
 * 缺省 12 个月，缺数月 source=MISSING，P0-10.32）。
 *
 * 与原型不同构（逐条登记）：原型 12 项项目 KPI 表格 + KpiDrawer 填报/证据上传
 * （PUT /performance/kpis/...）与共担 KPI 双组长确认读端点后端均未交付，后端为
 * 汇总计算读端点，维持真缺口登记。
 */
import { ipdGet } from './http';

/** 功能 KPI 指标来源项（KpiRecordService.KpiSourceItem；value 为原始值，contribution=value×weight）。 */
export interface KpiSourceItem {
  contribution: null | number | string;
  source: 'ALLOWANCE_LEDGER' | 'KPI_CALCULATOR' | 'PROJECT_SCORE';
  value: null | number | string;
  weight: null | number | string;
}

/** 绩效 KPI 聚合（BigDecimal 已转 string 防精度截断；必含 L1..L5 + COMPREHENSIVE）。 */
export type KpiPerformanceSummary = Record<'COMPREHENSIVE' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5', string>;

/** KPI 趋势点（source: DATA=有数，MISSING=缺数月补零）。 */
export interface KpiTrendPoint {
  period: string;
  recordId: null | string;
  source: 'DATA' | 'MISSING';
  value: null | number | string;
}

/** 功能 KPI 指标来源与计算（period 必填 YYYY-MM）。 */
export function getFunctionalKpi(period: string): Promise<KpiSourceItem[]> {
  return ipdGet<KpiSourceItem[]>('/kpi/functional', { period });
}

/** 绩效 KPI 聚合（period 必填 YYYY-MM）。 */
export function getPerformanceKpi(period: string): Promise<KpiPerformanceSummary> {
  return ipdGet<KpiPerformanceSummary>('/kpi/performance', { period });
}

/** 历史 KPI 趋势（periods 回看月数 1~36，缺省 12）。 */
export function getKpiTrend(periods?: number): Promise<KpiTrendPoint[]> {
  return ipdGet<KpiTrendPoint[]>('/kpi/trend', periods === undefined ? undefined : { periods });
}
