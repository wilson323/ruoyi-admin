/**
 * KPI 考核接口（页29 KPI 考核 / 原型 /performance 项目KPI / P3-1.1~1.3）+
 * 共担 KPI 归集列表（页30 / W4-E 补交付）+
 * KPI 原始数据录入（R149 增量交付；后端写端点待交付，前端先把录入/展示闭环）。
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
 *
 * KPI 原始数据录入（raw-records）来源：前端录入/展示界面按 8 项固定类型枚举
 * （REVENUE / CHANNEL_COUNT / NPS / SCENE_COUNT / BUG_COUNT / COMPLAINT_COUNT /
 * CERT_COUNT / COMPLETION_RATE）。后端写端点 /api/v1/kpi/raw-records 待交付，
 * 当前前端页面如实展示「后端端点不存在」错误，不假绿。
 */
import { ipdGet, ipdPost } from './http';

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
 * KPI 原始数据录入：8 项固定类型枚举（R149 录入/展示界面配套）。
 * 字段语义：销售/渠道/NPS/场景/缺陷/投诉/认证/完成率——原型 12 项 KPI 表格精简后落地；
 * COMPLETION_RATE 范围 0-1，其余为整数或万元金额（按 label 单位）。
 */
export const KPI_RAW_TYPES = [
  { value: 'REVENUE', label: '销售收入（万元）' },
  { value: 'CHANNEL_COUNT', label: '渠道数' },
  { value: 'NPS', label: '客户满意度 NPS' },
  { value: 'SCENE_COUNT', label: '落地场景数' },
  { value: 'BUG_COUNT', label: '缺陷数' },
  { value: 'COMPLAINT_COUNT', label: '投诉数' },
  { value: 'CERT_COUNT', label: '国别认证数' },
  { value: 'COMPLETION_RATE', label: '里程碑完成率（0-1）' },
] as const;
export type KpiRawType = (typeof KPI_RAW_TYPES)[number]['value'];

/** KPI 原始记录（后端 RawKpiRecord 字段对齐；period YYYY-MM-DD；rawValue 数字）。 */
export interface RawKpiRecord {
  id: null | string;
  projectId: null | string;
  kpiType: KpiRawType | string;
  period: null | string;
  rawValue: null | number | string;
  remark: null | string;
  recordedBy: null | string;
  recordedAt: null | string;
  segment: string;
}

/** 录入请求体（白名单 DTO：projectId/kpiType/period/rawValue/remark；其余服务端权威）。 */
export interface RawKpiRecordCreateReq {
  projectId: string;
  kpiType: KpiRawType;
  period: string;
  rawValue: number;
  remark?: null | string;
}

/** 列表查询参数（projectId/kpiType 可选；不传返回全部可见项目）。 */
export interface RawKpiRecordQuery {
  kpiType?: KpiRawType | string;
  projectId?: string;
}

/** KPI 原始记录列表（R149；后端待交付 GET /api/v1/kpi/raw-records）。 */
export function listRawKpiRecords(query?: RawKpiRecordQuery): Promise<RawKpiRecord[]> {
  return ipdGet<RawKpiRecord[]>('/kpi/raw-records', query as Record<string, unknown>);
}

/** 录入一条 KPI 原始记录（R149；后端待交付 POST /api/v1/kpi/raw-records）。 */
export function createRawKpiRecord(body: RawKpiRecordCreateReq): Promise<RawKpiRecord> {
  return ipdPost<RawKpiRecord>('/kpi/raw-records', body);
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
