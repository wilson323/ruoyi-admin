/**
 * KPI 考核接口（页29 KPI 考核 / 原型 /performance 项目KPI / P3-1.1~1.3）+
 * 共担 KPI 归集列表（页30 / W4-E 补交付）。
 *
 * 真值：KpiRecordController（/api/v1/kpi/...，2026-09-06 磁盘核实，权限 ipd:kpi:query）。
 * 已交付端点：GET /functional?period（功能 KPI 指标来源与加权贡献，P0-10.29）、
 * GET /performance?period（绩效 KPI 聚合：L1..L5 津贴分档合计 + COMPREHENSIVE
 * 项目加权分经奖金池阶梯系数映射 ×100，P0-10.30）、GET /trend?periods（历史趋势，
 * 缺省 12 个月，缺数月 source=MISSING，P0-10.32）。
 *
 * 共担 KPI（页30 归集列表 / W4-E）：GET /kpi/shared?projectId&period
 * → SharedKpiController.listShared（2026-09-06 补交付；此前前端调必 404）。
 *
 * 与原型不同构（逐条登记）：原型 12 项项目 KPI 表格 + KpiDrawer 填报/证据上传
 * （PUT /performance/kpis/...）后端仍未交付，后端为
 * 汇总计算读端点 + 共担 KPI 列表读端点，维持真缺口登记。
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

/**
 * 共担 KPI 归集记录（W4-E；字段对齐后端 domain KpiRecord，共担四项 kpiType=SHARED）。
 * 同一项目双 PM 各 1 条同 revision；多次归集 → revision 递增追加，服务层按 revision DESC 排序。
 */
export interface SharedKpiRecord {
  id: null | string;
  projectId: null | string;
  personId: null | string;
  kpiType: 'SHARED';
  period: string;
  comprehensiveScore: null | number | string;
  revision: null | number;
  scoredBy: null | string;
  status: 'DRAFT' | 'FINALIZED';
  segment: string;
  scoredAt: null | string;
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

/**
 * 共担 KPI 归集列表（页30 / W4-E）。
 *
 * 真值：SharedKpiController.listShared（GET /api/v1/kpi/shared?projectId&period）
 *   返回 List<KpiRecord>（含 kpiType=SHARED 全部 revision，按 revision DESC 排序）。
 *   权限 ipd:kpi:query（MARKET_PM / RD_PM / GROUP_LEADER / SUPER_ADMIN）。
 *
 * 注：服务同时实现 POST /kpi/shared（归集录入）与 POST /kpi/shared/deadline-scan（月度逾期扫描，
 * 仅超管），本文件暂不封装这两个端点——归集录入走表单专用 mutation hook，扫描由后端 cron 触发。
 */
export function listSharedKpis(projectId: number, period: string): Promise<SharedKpiRecord[]> {
  return ipdGet<SharedKpiRecord[]>('/kpi/shared', { projectId, period });
}
