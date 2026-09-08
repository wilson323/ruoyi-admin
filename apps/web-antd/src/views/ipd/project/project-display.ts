/**
 * 项目域展示辅助（页07-09 + 页12/13 共享的术语/状态/时间映射）。
 *
 * 状态/阶段/级别/模板/来源/补齐/动作深度/算法分类等纯展示映射已迁入 `_shared/ipd-enums.ts`，
 * 本文件只保留：从 SSOT 表到 view 层友好接口的薄包装、STAGE_ORDER（六阶段视觉骨架）、
 * 以及 `parseMarkets / projectMoneyText / coefficientText / projectDateTimeText / projectDateText`
 * 等纯解析函数。
 *
 * 真值：docs/开发说明/spec/_公共规范.md + Project.java / StageAction.java 字段枚举。
 * G-06：未知值一律「待补充」；禁止绝对化文案。
 */
import { formatDate, formatDateTime, formatMoney, PENDING_TEXT } from '../_shared/format';
import {
  ALGO_TEXT,
  CATCHUP_TEXT,
  DEPTH_COLOR,
  DEPTH_TEXT,
  LEVEL_TEXT,
  PERSON_TYPE_TEXT_FROM_ROLE,
  SOURCE_TEXT,
  STAGE_TEXT,
  STAGE_TONE,
  TEMPLATE_TEXT,
  actionStatusLabel,
  actionStatusTone,
  projectStateLabel,
  projectStateTone,
} from '../_shared/ipd-enums';

export const PROJECT_UNKNOWN = '待补充';

/** 项目状态机：DRAFT/TEAMING/ACTIVE/SUSPENDED/ARCHIVED。 */
export function projectStatusText(status: null | string | undefined): string {
  return projectStateLabel(status, PROJECT_UNKNOWN);
}

export function projectStatusColor(status: null | string | undefined): string {
  return projectStateTone(status);
}

/** 当前阶段 CONCEPT→PLAN→DEV→VALID→LAUNCH→LIFECYCLE。 */
export function stageText(stage: null | string | undefined): string {
  if (!stage) return PROJECT_UNKNOWN;
  return STAGE_TEXT[stage] ?? PROJECT_UNKNOWN;
}

export function stageColor(stage: null | string | undefined): string {
  return STAGE_TONE[stage ?? ''] ?? 'default';
}

/** 立项级别 S/A/B（A 默认；S/B 必填 levelCoefficientReason）。 */
export function levelText(level: null | string | undefined): string {
  if (!level) return PROJECT_UNKNOWN;
  return LEVEL_TEXT[level] ?? PROJECT_UNKNOWN;
}

/** 模板类型 HARDWARE/SOFTWARE/SOLUTION（BR-PROD-02 三模板分支）。 */
export function templateText(type: null | string | undefined): string {
  if (!type) return PROJECT_UNKNOWN;
  return TEMPLATE_TEXT[type] ?? PROJECT_UNKNOWN;
}

/** 项目来源 NEW/LEGACY（存量导入）。 */
export function sourceText(source: null | string | undefined): string {
  if (!source) return PROJECT_UNKNOWN;
  return SOURCE_TEXT[source] ?? PROJECT_UNKNOWN;
}

/** 补齐状态（存量项目 IN_PROGRESS/COMPLETE）。 */
export function catchupText(value: null | string | undefined): string {
  if (!value) return PROJECT_UNKNOWN;
  return CATCHUP_TEXT[value] ?? PROJECT_UNKNOWN;
}

/** 目标市场（JSON 字符串 → 国家代码数组）严格解析；畸形数据兜底空数组。 */
export function parseMarkets(value: null | string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
  } catch { /* 畸形 JSON：忽略按空数组处理（G-06） */ }
  return [];
}

/** 立项销售额：BigDecimal 字符串/数字 → 千分位两位小数。 */
export function projectMoneyText(value: null | number | string): string {
  return formatMoney(value);
}

/** 系数（保留 4 位小数，避免 1.5 显示成 1.500000）。 */
export function coefficientText(value: null | number | string): string {
  if (value === null || value === undefined || value === '') return PENDING_TEXT;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return PENDING_TEXT;
  return num.toFixed(4).replace(/\.?0+$/, '');
}

/** 上市日期 / 存量生效日：归一为 ISO 后交给 formatDate。 */
export function projectDateText(value: null | number | string | undefined): string {
  if (value === null || value === undefined || value === '') return PENDING_TEXT;
  if (typeof value === 'string' && value.includes(' ')) {
    return formatDate(value.replace(' ', 'T'));
  }
  return formatDate(value);
}

export function projectDateTimeText(value: null | number | string | undefined): string {
  if (value === null || value === undefined || value === '') return PENDING_TEXT;
  if (typeof value === 'string' && value.includes(' ')) {
    return formatDateTime(value.replace(' ', 'T'));
  }
  return formatDateTime(value);
}

/** 动作深度 DEEP/LIGHT（公共规范第六节 + BR-IPD-03/04）。 */
export function depthText(depth: null | string | undefined): string {
  if (!depth) return PROJECT_UNKNOWN;
  return DEPTH_TEXT[depth] ?? PROJECT_UNKNOWN;
}

export function depthColor(depth: null | string | undefined): string {
  return DEPTH_COLOR[depth ?? ''] ?? 'default';
}

/** 动作状态机 NOT_STARTED/IN_PROGRESS/DONE/DELAYED/NA（迁自 _shared/ipd-state-machines.ACTION_STATUS_MACHINE）。 */
export function actionStatusText(status: null | string | undefined): string {
  return actionStatusLabel(status, PROJECT_UNKNOWN);
}

export function actionStatusColor(status: null | string | undefined): string {
  return actionStatusTone(status);
}

/** 历史缺失标记（BR-PROD-03：不伪造 DONE，门禁视为已满足）。 */
const HISTORY_MARK_TEXT: Record<string, string> = {
  HISTORICAL_MISSING: '历史缺失',
};

export function historyMarkText(value: null | string | undefined): string {
  if (!value) return '';
  return HISTORY_MARK_TEXT[value] ?? value;
}

/** 算法分类 FINGERPRINT/FACE/PALM/VEIN/MULTI（迁自 _shared/ipd-enums.ALGO_TEXT）。 */
export function algoText(value: null | string | undefined): string {
  if (!value) return PROJECT_UNKNOWN;
  return ALGO_TEXT[value] ?? PROJECT_UNKNOWN;
}

/** 阻断性动作徽标（BR-IPD-06；P10/V02/D11 等）。 */
export function blockingBadge(isBlocking: null | string | undefined): string {
  return isBlocking === '1' || isBlocking === 'true' ? '阻断性动作' : '';
}

/** 角色 → 可见项目筛选规则（页07 BR-ORG-06；按当前会话主体）。 */
export type ProjectScope = 'all' | 'group' | 'mine';

/** 已知角色中文显示（G-09：产品组长不允许改名为「评审上级」等）。 */
export function personTypeText(type: null | string | undefined): string {
  if (!type) return PROJECT_UNKNOWN;
  return PERSON_TYPE_TEXT_FROM_ROLE[type] ?? PROJECT_UNKNOWN;
}

/** 六阶段顺序（深管卡片/轻管行的视觉骨架）。 */
export const STAGE_ORDER: Array<{ code: string; label: string }> = [
  { code: 'CONCEPT', label: '概念' },
  { code: 'PLAN', label: '计划' },
  { code: 'DEV', label: '开发' },
  { code: 'VALID', label: '验证' },
  { code: 'LAUNCH', label: '发布' },
  { code: 'LIFECYCLE', label: '生命周期' },
];