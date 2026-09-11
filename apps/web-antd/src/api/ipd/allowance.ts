/**
 * 月度津贴接口（页33 津贴台账；P3-3.1/3.2/3.3；AC-INC-03~08；BR-INC-03）。
 *
 * ✅ 状态 2026-09-06（W4-D 已交付）：AllowanceLedgerController 3 端点上线。
 *   - GET  /api/v1/allowance/ledger         — 津贴快照（AllowanceLedgerService.list）
 *   - GET  /api/v1/allowance/pending-stop   — 待停发清单（AllowanceLedgerService.pendingStop）
 *   - POST /api/v1/allowance/auto-scan      — 月度自动扫描（AllowanceLedgerService.autoScan，仅超管）
 * 权限：list / pending-stop → `ipd:kpi:query`（MARKET_PM / RD_PM / GROUP_LEADER / SUPER_ADMIN 可见）；
 * auto-scan → 仅 SUPER_ADMIN（`ipdPermission.requireAdmin()` 兜底，不挂注解防 OPS-09 漂移）。
 * 路由 meta 已切真视图（router/routes/modules/ipd.ts IpdAllowance 已删除 ipdBackend 标注）。
 *
 * 📌 字段对齐（D-补强 R1，2026-09-06）：下方 AllowanceLedger 已按后端 domain AllowanceLedger
 * 字段（id / personId / projectId / month / lockedLevel / baseAmount / finalAmount /
 * capApplied / stopReason / stopStartDate / delFlag + BaseEntity.createTime）补齐；旧字段
 * period / level / amount / capReached / projectCount / projectIds 标 @deprecated 保留（避免
 * 直接 break 现有 import；与 W3-A5 奖金池做兼容时使用过同组字段）；status 字段后端零对应、
 * 无法从任何后端字段映射，**已删除**（停发语义以 stopReason 表达：SCORE_BELOW_60 /
 * NO_OUTPUT_60_DAYS / STOP_SCORE_BELOW_60 / STOP_NO_OUTPUT_60_DAYS）。
 *
 * 业务规则（BR-INC-03；后端校验侧已实现）：L1~L5 锁定评级 × 绑定项目数叠加，封顶 2 倍
 * （AllowanceLedgerService.LOCKED_LEVELS / DEFAULT_CAP_MULTIPLIER = 2.0）；综合分 < 60 当月停发
 * （AllowanceService.SCORE_STOP_THRESHOLD = 60）；附加项目连续 60 天无产出 ⇒ 待确认停发单
 * （NO_OUTPUT_DAYS_THRESHOLD = 60；主项目无产出不触发）；不乘绩效系数。
 * 注：分档基数（1000/1500/2000/2500/3000）为规格口径，后端未硬编码，作 baseAmount 入参校验。
 */
import { ipdGet, ipdPost } from './http';

export interface AllowanceLedger {
  // ---- D-补强 R1：W4-D 后端 domain AllowanceLedger 真实字段 ----

  /** 主键（雪花算法 Long；前端按 string/number 透传） */
  id: null | number | string;
  /** 人员 ID（Long） */
  personId: null | number | string;
  /** 项目 ID（Long；后端为「一行一项目」，无 projectIds 聚合） */
  projectId: null | number | string;
  /** 台账月份 YYYY-MM（与旧字段 period 语义相同） */
  month: null | string;
  /** 锁定评级 L1~L5（AllowanceLedgerService.LOCKED_LEVELS；与旧字段 level 语义相同） */
  lockedLevel: null | string;
  /** 基准额（BigDecimal 序列化为字符串；前端可原样透传） */
  baseAmount: null | number | string;
  /** 终额（多项目叠加、2 倍封顶；与旧字段 amount 语义相同） */
  finalAmount: null | number | string;
  /** 是否触发封顶（"1" 触发 / "0" 未触发；前端视图按 '1' → 警告 tag 渲染） */
  capApplied: null | string;
  /** 停发原因（SCORE_BELOW_60 / NO_OUTPUT_60_DAYS / STOP_*；null 表示正常发放） */
  stopReason: null | string;
  /** 停发开始日期（Date） */
  stopStartDate?: null | string;
  /** 记录生成时间（BaseEntity.createTime） */
  createTime: null | string;
  /** 软删除标志（"0" 正常 / "1" 已删；TableLogic） */
  delFlag?: null | string;

  // ---- D-补强前预留字段：标 @deprecated，与 W4-D 后端命名不一致 ----
  // 保留这些字段仅避免外部 import break；新代码请直接使用上方对齐后的字段。

  /** @deprecated 后端实际字段为 `month`；保留兼容。 */
  period?: string;
  /** @deprecated 后端实际字段为 `lockedLevel`；保留兼容。 */
  level?: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  /** @deprecated 后端实际字段为 `finalAmount`；保留兼容。 */
  amount?: null | number | string;
  /** @deprecated 后端实际字段为 `capApplied`（"0"/"1" 字符串）；保留兼容。 */
  capReached?: boolean;
  /** @deprecated 后端为「一行一项目」结构，无 projectCount 字段；保留兼容。 */
  projectCount?: number;
  /** @deprecated 后端为「一行一项目」结构，无 projectIds 字段；保留兼容。 */
  projectIds?: null | string[];
}

/**
 * 月度津贴台账列表（period 必填 YYYY-MM；personId 可选按角色范围）。
 *
 * ✅ W4-D 已交付：`GET /api/v1/allowance/ledger`（AllowanceLedgerService.list）。
 * 权限：ipd:kpi:query（MARKET_PM / RD_PM / GROUP_LEADER / SUPER_ADMIN 可见）。
 */
export function listAllowances(period: string, personId?: string): Promise<AllowanceLedger[]> {
  return ipdGet<AllowanceLedger[]>('/allowance/ledger', personId ? { period, personId } : { period });
}

/**
 * 当月综合分 < 60 命中扫描结果（停发提示）。
 *
 * ✅ W4-D 已交付：`GET /api/v1/allowance/pending-stop`（AllowanceLedgerService.pendingStop）。
 * 权限：ipd:kpi:query。后端按 `stopReason IS NOT NULL` 过滤。
 */
export function getAllowancePendingStop(period: string): Promise<AllowanceLedger[]> {
  return ipdGet<AllowanceLedger[]>('/allowance/pending-stop', { period });
}

/**
 * 月度自动扫描（仅超管）。
 *
 * ✅ W4-D 已交付：`POST /api/v1/allowance/auto-scan`（AllowanceLedgerService.autoScan）。
 * 权限：SUPER_ADMIN（ipdPermission.requireAdmin() 兜底，不挂注解）。
 */
export function triggerAllowanceAutoScan(period: string, projectId?: string): Promise<void> {
  const query = projectId ? { period, projectId } : { period };
  return ipdPost<unknown>('/allowance/auto-scan', undefined, query).then(() => undefined);
}
