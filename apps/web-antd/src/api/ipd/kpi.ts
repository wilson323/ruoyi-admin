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
 * KPI 原始数据录入（raw-records）：类型枚举改由权威端点 GET /kpi/raw-records/types
 * 下发（ORPHAN-A6，2026-09-25 接线）；本地 8 项清单降级为回退口径（拉取失败/为空时使用，
 * 编码与后端 KpiRawRecordService.listSupportedTypes 同源：REVENUE / CHANNEL_COUNT / NPS /
 * SCENE_COUNT / BUG_COUNT / COMPLAINT_COUNT / CERT_COUNT / COMPLETION_RATE）。
 *
 * ORPHAN-A6（看板卡 8338f2fa，R212 孤儿桶 #37/#39/#40）增量：
 * - DELETE /kpi/functional-metrics/{id}（软删除，ipd:kpi:config）
 * - GET  /kpi/functional-metrics/codes（权威枚举，页面消费见 functional/index.vue）
 * - GET  /kpi/raw-records/types（权威枚举，页面消费见 raw-records.vue）
 *
 * ORPHAN-A7（看板卡 670aecdf，R212 孤儿桶 #79/#80/#82，原型页30）增量：
 * - GET  /kpi/shared/confirms?projectId&period[&status]（双组长确认列表，P3-1.2-BACKEND）
 * - GET  /kpi/shared/deadline-config（月度截止配置视图，HIGH-4.1；
 *   后端无 PUT 写端点——配置变更走 SystemConfigController PUT /system-configs/{key}
 *   的 kpi.monthlyDeadlineDay，本文件不封装写路径，如实登记）
 * - POST /kpi/shared/{id}/confirm（双组长签署，ipd:kpi-shared:confirm）
 */
import { ipdDelete, ipdGet, ipdPost, ipdPut } from './http';

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
export function listSharedKpis(projectId: string, period: string): Promise<SharedKpiRecord[]> {
  return ipdGet<SharedKpiRecord[]>('/kpi/shared', { projectId, period });
}

/**
 * KPI 功能指标量表（A2 P1，R148.1 §2.2 方案②；owner 2026-09-21 拍板，§例外 4）。
 *
 * 真值：GET /api/v1/kpi/functional-metrics?projectId&metricCode（读，ipd:kpi:config:query）、
 *      PUT /api/v1/kpi/functional-metrics（upsert，ipd:kpi:config，超管 + 双 PM 可写）。
 * 8 项功能指标取 DOC-01 §4 既定口径（市场 4 + 研发 4），编码对齐后端
 * KpiScoreCalculator 的 MARKET_PM_FUNCTIONAL_FIELDS / RD_PM_FUNCTIONAL_FIELDS 字段名；
 * K01-K04 属共担 KPI（kpi_records SHARED），不在本表范围。
 * scaleVersion 为 VARCHAR(50) 自由文本，不加外键（R-A2：kpi_rule_snapshots 空表互锁）。
 */
export const KPI_FUNCTIONAL_METRIC_CODES = [
  { value: 'MKT_REQUIREMENT_ACCURACY', label: '市场·需求准确率' },
  { value: 'MKT_WINDOW_HIT_RATE', label: '市场·窗口命中率' },
  { value: 'MKT_SCENARIO_COMPETITIVENESS', label: '市场·场景方案竞争力' },
  { value: 'MKT_COMPETITOR_INTELLIGENCE', label: '市场·竞品情报质量' },
  { value: 'RD_LAUNCH_ON_TIME_RATE', label: '研发·上市准时率' },
  { value: 'RD_QUALITY_DEFECT_RATE', label: '研发·质量缺陷率（PPM）' },
  { value: 'RD_TECH_INNOVATION', label: '研发·技术创新度' },
  { value: 'RD_FIRST_PASS_YIELD', label: '研发·需求一次性实现率' },
] as const;
export type KpiFunctionalMetricCode = (typeof KPI_FUNCTIONAL_METRIC_CODES)[number]['value'];

/** 功能指标量表记录（字段对齐后端 domain KpiFunctionalMetric；BigDecimal 按字符串原样透传）。 */
export interface FunctionalMetricRecord {
  id: null | string;
  projectId: null | string;
  metricCode: string;
  period: string;
  metricValue: null | number | string;
  targetValue: null | number | string;
  scaleVersion: null | string;
  remark: null | string;
  updateBy?: null | string;
  updateTime?: null | string;
}

/** 录入 / 更新请求体（幂等键 projectId + metricCode + period；两值不可同时为空）。 */
export interface FunctionalMetricUpsertReq {
  projectId: string;
  metricCode: string;
  period: string;
  metricValue?: null | number;
  targetValue?: null | number;
  scaleVersion?: null | string;
  remark?: null | string;
}

/** 列出某项目功能指标量表记录（metricCode 可空，为空返回该项目全部记录）。 */
export function listFunctionalMetrics(projectId: string, metricCode?: string): Promise<FunctionalMetricRecord[]> {
  return ipdGet<FunctionalMetricRecord[]>('/kpi/functional-metrics', { projectId, metricCode });
}

/** 8 项功能指标编码枚举（后端权威清单，供下拉与对账）。 */
export function listFunctionalMetricCodes(): Promise<string[]> {
  return ipdGet<string[]>('/kpi/functional-metrics/codes');
}

/** 录入 / 更新一条功能指标（PUT upsert；同 (projectId, metricCode, period) 覆盖不追加）。 */
export function upsertFunctionalMetric(body: FunctionalMetricUpsertReq): Promise<FunctionalMetricRecord> {
  return ipdPut<FunctionalMetricRecord>('/kpi/functional-metrics', body);
}

/* =============== ORPHAN-A6（R212 #37/#39/#40，看板卡 8338f2fa） =============== */

/**
 * 软删除一条功能指标量表记录（R212 #37）。
 *
 * 真值：DELETE /api/v1/kpi/functional-metrics/{id} → KpiFunctionalMetricsController.delete
 *   （权限 ipd:kpi:config，超管 + 双 PM；软删除，Controller javadoc 自证）。
 * 成功返回 code=0 data=null；行不存在/权限不足按包络错误上抛（IpdRequestError）。
 */
export function deleteFunctionalMetric(id: string): Promise<void> {
  return ipdDelete<void>(`/kpi/functional-metrics/${id}`);
}

/**
 * KPI 原始记录类型权威枚举（R212 #40；R149 期页面曾硬编码 8 项，本端点接线后前端以下发为准）。
 *
 * 真值：GET /api/v1/kpi/raw-records/types → KpiRawRecordController.listTypes
 *   （权限 ipd:kpi:raw:query，MARKET_PM / RD_PM / GROUP_LEADER / SUPER_ADMIN）。
 */
export function listRawKpiRecordTypes(): Promise<string[]> {
  return ipdGet<string[]>('/kpi/raw-records/types');
}

/* =============== ORPHAN-A7（R212 #79/#80/#82，看板卡 670aecdf，原型页30） =============== */

/**
 * 共担 KPI 双组长确认行（P3-1.2-BACKEND，看板卡 56d97bb0 DTO 契约）。
 * 字段对齐后端 vo.KpiSharedConfirmView（字符串 ID + ISO 时间，防 BigInt 截断）。
 * status：PENDING=待确认 / CONFIRMED=已双签 / OVERDUE=已逾期（读时派生，不落库）。
 */
export interface SharedKpiConfirmRow {
  id: string;
  period: string;
  projectId: string;
  projectName: null | string;
  personId: null | string;
  personName: null | string;
  metricCode: string;
  metricName: null | string;
  weight: null | number | string;
  deadlineAt: null | string;
  status: string;
  firstConfirmedBy: null | string;
  firstConfirmedAt: null | string;
  secondConfirmedBy: null | string;
  secondConfirmedAt: null | string;
  /** 当前登录人是否已参与签署（前端「待我确认 / 我已确认」渲染依据）。 */
  confirmedByMe: boolean;
}

/**
 * 月度截止配置视图（HIGH-4.1；GET /kpi/shared/deadline-config 返回契约）。
 * source：FACTORY_DEFAULT=工厂默认 5 / DB_ACTIVE=库内生效 / DB_INACTIVE=库内停用回退默认。
 * 注：后端无 PUT 写端点，配置变更走 SystemConfig（key=kpi.monthlyDeadlineDay）。
 */
export interface SharedKpiDeadlineConfig {
  dayOfMonth: number;
  cutoffTime: null | string;
  version: number;
  source: string;
  configuredValue: null | string;
}

/** 双组长签署结果（confirmed=true 表示第二签落齐、行已 CONFIRMED）。 */
export interface SharedKpiConfirmResult {
  confirmed: boolean;
  status: string;
  firstConfirmedBy: null | string;
  secondConfirmedBy: null | string;
}

/**
 * 双组长确认视角列表（R212 #79）。
 *
 * 真值：GET /api/v1/kpi/shared/confirms?projectId&period[&status]
 *   → SharedKpiController.listConfirms（权限 ipd:kpi:query 四角色；
 *   status 仅支持 PENDING/CONFIRMED/OVERDUE，不传=全部；项目级 IDOR 防御与 listShared 同严）。
 */
export function listSharedConfirms(
  projectId: string,
  period: string,
  status?: string,
): Promise<SharedKpiConfirmRow[]> {
  const query: Record<string, unknown> = status === undefined ? { projectId, period } : { projectId, period, status };
  return ipdGet<SharedKpiConfirmRow[]>('/kpi/shared/confirms', query);
}

/**
 * 月度截止配置读（R212 #80 读侧；写侧后端未交付，见接口注释）。
 *
 * 真值：GET /api/v1/kpi/shared/deadline-config → SharedKpiController.getDeadlineConfig
 *   （权限 ipd:kpi:query；无查询参数）。
 */
export function getSharedDeadlineConfig(): Promise<SharedKpiDeadlineConfig> {
  return ipdGet<SharedKpiDeadlineConfig>('/kpi/shared/deadline-config');
}

/**
 * 双组长签署（R212 #82；首签记 first，第二位不同组长签记 second 并落 CONFIRMED）。
 *
 * 真值：POST /api/v1/kpi/shared/{id}/confirm → SharedKpiController.confirm
 *   （权限 ipd:kpi-shared:confirm，GROUP_LEADER / SUPER_ADMIN；
 *   同人重签 40002 DUAL_SIGN_INCOMPLETE、已确认再签 STATE_CONFLICT、OVERDUE 行仍可签）。
 */
export function confirmSharedKpi(id: string): Promise<SharedKpiConfirmResult> {
  return ipdPost<SharedKpiConfirmResult>(`/kpi/shared/${id}/confirm`);
}

/* ====================== R217-GAP-F11：KPI 生效规则说明（读侧） ====================== */

/**
 * KPI 生效规则视图（后端 org.ruoyi.ipd.vo.KpiRuleView record 一一对应）。
 *
 * 数值统一 string 化是后端刻意设计（vo 注释：防前端 BigInt 截断，与 /api/v1 包络
 * BigNumberSerializer 约定一致）——ruleValue 原样展示，严禁 Number()/parseFloat。
 */
export interface KpiRuleView {
  ruleKey: string;
  ruleValue: string;
}

/**
 * 当前生效 KPI 规则清单（R108 paiban-02 方案 B，零 DB 变更；R215 设计意图「前端展示规则清单」）。
 *
 * 真值：GET /api/v1/kpi/rules → KpiRulesController.rules（:40-44）
 *   （权限 ipd:kpi:query，MARKET_PM/RD_PM/GROUP_LEADER/SUPER_ADMIN 四角色可读 + requireInternal；
 *   零 path/query 参数；数据源 kpi_rule_snapshots 最新快照 rule_json 拍平 → 回退 system_configs kpi.* 键；
 *   空源返回空列表不 404（javadoc :37）→ 调用方渲染空态而非报错）。
 * 守卫：非数组脏数据归 []（契约漂移不炸面板）；逐行 String() 归一。
 */
export async function listKpiRules(): Promise<KpiRuleView[]> {
  // 按 unknown 落守卫再归一：后端契约是 KpiRuleView[]，但脏形状（非数组/缺键行）不得炸面板。
  const data: unknown = await ipdGet<unknown>('/kpi/rules');
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row))
    .map((row) => ({ ruleKey: String(row.ruleKey ?? ''), ruleValue: String(row.ruleValue ?? '') }));
}
