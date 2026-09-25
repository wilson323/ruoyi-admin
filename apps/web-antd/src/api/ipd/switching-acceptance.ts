/**
 * 月度账务切换验收 API（R215 GAP-F5，原 A23 预留码兑现；P3-7.1；BR-INC-12；AC-INC-50/51）。
 *
 * 后端真值：ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller/SwitchingAcceptanceController.java：
 * - POST /switching-acceptance/{month}/run    运行对账（ipd:switching-acceptance:lock；ADMIN_WRITE 仅超管 :40）
 * - GET  /switching-acceptance/{month}        获取报告（ipd:switching-acceptance:query :47）
 * - POST /switching-acceptance/{month}/lock   月度锁定（…:lock :53）
 * - POST /switching-acceptance/{month}/unlock 月度解锁（…:unlock :60；body {reason} @NotBlank @Size(5,500)）
 * - GET  /switching-acceptance                列出已 run 月份（…:query :69）
 *
 * 权限口径（控制器 2026-09-09 收紧注 :36-39）：run/lock/unlock 三写口挂 LOCK/UNLOCK 码
 * （ADMIN_WRITE 集合仅 SUPER_ADMIN）；admin 别名 ipd:switching-acceptance:admin 是死码
 * （注解侧已弃用、常量残留 IpdPermissionCode.java:125），前端禁用其做门禁。
 *
 * 契约口径：
 * - month 路径段 yyyy-MM 补零格式（2026-8 非法），api 层守卫拦截非法格式不发请求；
 * - ranBy/lockedBy/unlockedBy 三 Long 经 BigNumberSerializer 双形态 → String() 归一禁 Number()；
 * - diffRate/diff/kpiScoreSum/bonusDistributionSum 是 BigDecimal——后端全局 ToStringSerializer
 *   （JacksonConfig.java:45）恒 string 下发 → 前端精度串原样透传，禁 parseFloat/Number()（展示层不改数值）；
 * - SwitchingAcceptanceReport @JsonInclude(NON_NULL)（:24）→ 全字段按可空处理，缺键归 null 不炸；
 * - summary Map<String,Integer> 计数归一 number；isLocked/passed 严格 === true。
 */
import { ipdGet, ipdPost } from './http';

/** 月份格式守卫：yyyy-MM 补零（2026-8 非法；后端 PathVariable String 直收，格式错=对账月份错位 P0）。 */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month: string): string {
  if (!MONTH_PATTERN.test(month)) {
    throw new Error(`月份格式必须为 yyyy-MM（补零），收到「${month}」`);
  }
  return month;
}

/** 校验明细（CheckResult record :43-53；expected/actual 为 Object 透传，四个 BigDecimal 恒 string）。 */
export interface SwitchingCheckResult {
  actual: unknown;
  bonusDistributionSum: null | string;
  diff: null | string;
  duplicateCount: null | number;
  expected: unknown;
  kpiScoreSum: null | string;
  name: null | string;
  note: null | string;
  passed: boolean;
}

/** 月度验收报告（SwitchingAcceptanceReport record :25-39 归一；NON_NULL → 全字段可空）。 */
export interface SwitchingAcceptanceReportView {
  checks: SwitchingCheckResult[];
  diffRate: null | string;
  isLocked: boolean;
  lockedAt: null | string;
  lockedBy: null | string;
  month: null | string;
  passed: boolean;
  ranAt: null | string;
  ranBy: null | string;
  summary: Record<string, number>;
  unlockReason: null | string;
  unlockedAt: null | string;
  unlockedBy: null | string;
}

function strOr(v: unknown): null | string {
  return v == null ? null : String(v);
}

function numOr(v: unknown): null | number {
  return v == null ? null : Number(v);
}

/** BigDecimal 精度串归一：后端恒 string 下发，number 形态（异常通道）也仅 String() 展示态，禁 parseFloat。 */
function decimalOr(v: unknown): null | string {
  return v == null ? null : String(v);
}

/** CheckResult 行归一（NON_NULL 缺键 → null 不炸；duplicateCount Integer 计数 Number）。 */
function normalizeCheck(raw: unknown): SwitchingCheckResult {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    actual: row.actual ?? null,
    bonusDistributionSum: decimalOr(row.bonusDistributionSum),
    diff: decimalOr(row.diff),
    duplicateCount: numOr(row.duplicateCount),
    expected: row.expected ?? null,
    kpiScoreSum: decimalOr(row.kpiScoreSum),
    name: strOr(row.name),
    note: strOr(row.note),
    passed: row.passed === true,
  };
}

/** SwitchingAcceptanceReport 归一（仿 hr-sync.ts normalize 范式；Date 字段 string 透传不做 Date()）。 */
export function normalizeReport(raw: unknown): SwitchingAcceptanceReportView {
  const row = (raw ?? {}) as Record<string, unknown>;
  const summary: Record<string, number> = {};
  if (row.summary != null && typeof row.summary === 'object') {
    for (const [k, v] of Object.entries(row.summary as Record<string, unknown>)) {
      summary[k] = Number(v ?? 0); // Integer 计数类 Number 归一
    }
  }
  return {
    checks: Array.isArray(row.checks) ? (row.checks as unknown[]).map(normalizeCheck) : [],
    diffRate: decimalOr(row.diffRate),
    isLocked: row.isLocked === true,
    lockedAt: strOr(row.lockedAt),
    lockedBy: strOr(row.lockedBy),
    month: strOr(row.month),
    passed: row.passed === true,
    ranAt: strOr(row.ranAt),
    ranBy: strOr(row.ranBy),
    summary,
    unlockReason: strOr(row.unlockReason),
    unlockedAt: strOr(row.unlockedAt),
    unlockedBy: strOr(row.unlockedBy),
  };
}

/** 运行月度对账（仅超管；POST …/{month}/run，无 body）。 */
export async function runSwitchingAcceptance(month: string): Promise<SwitchingAcceptanceReportView> {
  const m = assertMonth(month);
  const r = await ipdPost<unknown>(`/switching-acceptance/${encodeURIComponent(m)}/run`);
  return normalizeReport(r);
}

/** 获取某月报告（QUERY 码；GET …/{month}）。 */
export async function getSwitchingAcceptance(month: string): Promise<SwitchingAcceptanceReportView> {
  const m = assertMonth(month);
  const r = await ipdGet<unknown>(`/switching-acceptance/${encodeURIComponent(m)}`);
  return normalizeReport(r);
}

/** 月度锁定（仅超管；POST …/{month}/lock，无 body）。 */
export async function lockSwitchingAcceptance(month: string): Promise<SwitchingAcceptanceReportView> {
  const m = assertMonth(month);
  const r = await ipdPost<unknown>(`/switching-acceptance/${encodeURIComponent(m)}/lock`);
  return normalizeReport(r);
}

/**
 * 月度解锁（仅超管；POST …/{month}/unlock，body SwitchingAcceptanceUnlockReq 恰一键）。
 * reason @NotBlank @Size(5,500)——api 层做同口径前置校验，非法不发请求（省一次注定 400 的往返）。
 */
export async function unlockSwitchingAcceptance(month: string, reason: string): Promise<SwitchingAcceptanceReportView> {
  const m = assertMonth(month);
  const trimmed = reason.trim();
  if (trimmed.length < 5 || trimmed.length > 500) {
    throw new Error(`解锁理由须 5-500 字符（后端 @Size(5,500)），当前 ${trimmed.length} 字`);
  }
  const r = await ipdPost<unknown>(`/switching-acceptance/${encodeURIComponent(m)}/unlock`, { reason: trimmed });
  return normalizeReport(r);
}

/** 列出已 run 月份（QUERY 码；GET /switching-acceptance）。 */
export async function listSwitchingAcceptance(): Promise<SwitchingAcceptanceReportView[]> {
  const rows = await ipdGet<unknown[]>('/switching-acceptance');
  return (rows ?? []).map(normalizeReport);
}
