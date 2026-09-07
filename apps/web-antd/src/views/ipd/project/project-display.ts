/**
 * 项目域展示辅助（页07-09 + 页12/13 共享的术语/状态/时间映射）。
 *
 * 真值：docs/开发说明/spec/_公共规范.md + Project.java / StageAction.java 字段枚举。
 * G-06：未知值一律「待补充」；禁止绝对化文案。
 */
import { formatDate, formatDateTime, formatMoney, PENDING_TEXT } from '../_shared/format';

export const PROJECT_UNKNOWN = '待补充';

/** 项目状态机：DRAFT/TEAMING/ACTIVE/SUSPENDED/ARCHIVED。 */
const PROJECT_STATUS_TEXT: Record<string, string> = {
  ACTIVE: '进行中',
  ARCHIVED: '已归档',
  DRAFT: '草稿',
  SUSPENDED: '已暂停',
  TEAMING: '组队中',
};

const PROJECT_STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'processing',
  ARCHIVED: 'default',
  DRAFT: 'default',
  SUSPENDED: 'warning',
  TEAMING: 'warning',
};

/** 当前阶段 CONCEPT→PLAN→DEV→VALID→LAUNCH→LIFECYCLE。 */
const STAGE_TEXT: Record<string, string> = {
  CONCEPT: '概念阶段',
  DEV: '开发阶段',
  LAUNCH: '发布阶段',
  LIFECYCLE: '生命周期',
  PLAN: '计划阶段',
  VALID: '验证阶段',
};

const STAGE_COLOR: Record<string, string> = {
  CONCEPT: 'default',
  DEV: 'processing',
  LAUNCH: 'success',
  LIFECYCLE: 'default',
  PLAN: 'warning',
  VALID: 'warning',
};

/** 立项级别 S/A/B（A 默认；S/B 必填 levelCoefficientReason）。 */
const LEVEL_TEXT: Record<string, string> = {
  A: 'A 级（标准）',
  B: 'B 级（差异化下调）',
  S: 'S 级（战略）',
};

/** 模板类型 HARDWARE/SOFTWARE/SOLUTION（BR-PROD-02 三模板分支）。 */
const TEMPLATE_TEXT: Record<string, string> = {
  HARDWARE: '硬件',
  SOFTWARE: '软件',
  SOLUTION: '解决方案',
};

/** 项目来源 NEW/LEGACY（存量导入）。 */
const SOURCE_TEXT: Record<string, string> = {
  LEGACY: '存量导入',
  NEW: '新建',
};

/** 补齐状态（存量项目 IN_PROGRESS/COMPLE）。 */
const CATCHUP_TEXT: Record<string, string> = {
  COMPLETE: '已补齐',
  IN_PROGRESS: '补齐中',
};

export function projectStatusText(status: null | string | undefined): string {
  if (!status) return PROJECT_UNKNOWN;
  return PROJECT_STATUS_TEXT[status] ?? PROJECT_UNKNOWN;
}

export function projectStatusColor(status: null | string | undefined): string {
  return PROJECT_STATUS_COLOR[status ?? ''] ?? 'default';
}

export function stageText(stage: null | string | undefined): string {
  if (!stage) return PROJECT_UNKNOWN;
  return STAGE_TEXT[stage] ?? PROJECT_UNKNOWN;
}

export function stageColor(stage: null | string | undefined): string {
  return STAGE_COLOR[stage ?? ''] ?? 'default';
}

export function levelText(level: null | string | undefined): string {
  if (!level) return PROJECT_UNKNOWN;
  return LEVEL_TEXT[level] ?? PROJECT_UNKNOWN;
}

export function templateText(type: null | string | undefined): string {
  if (!type) return PROJECT_UNKNOWN;
  return TEMPLATE_TEXT[type] ?? PROJECT_UNKNOWN;
}

export function sourceText(source: null | string | undefined): string {
  if (!source) return PROJECT_UNKNOWN;
  return SOURCE_TEXT[source] ?? PROJECT_UNKNOWN;
}

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
const DEPTH_TEXT: Record<string, string> = {
  DEEP: '深管动作',
  LIGHT: '轻管动作',
};

const DEPTH_COLOR: Record<string, string> = {
  DEEP: 'processing',
  LIGHT: 'default',
};

/** 动作状态机 NOT_STARTED/IN_PROGRESS/DONE/DELAYED/NA。 */
const ACTION_STATUS_TEXT: Record<string, string> = {
  DELAYED: '已逾期',
  DONE: '已完成',
  IN_PROGRESS: '进行中',
  NA: '不适用',
  NOT_STARTED: '未开始',
};

const ACTION_STATUS_COLOR: Record<string, string> = {
  DELAYED: 'warning',
  DONE: 'success',
  IN_PROGRESS: 'processing',
  NA: 'default',
  NOT_STARTED: 'default',
};

export function depthText(depth: null | string | undefined): string {
  if (!depth) return PROJECT_UNKNOWN;
  return DEPTH_TEXT[depth] ?? PROJECT_UNKNOWN;
}

export function depthColor(depth: null | string | undefined): string {
  return DEPTH_COLOR[depth ?? ''] ?? 'default';
}

export function actionStatusText(status: null | string | undefined): string {
  if (!status) return PROJECT_UNKNOWN;
  return ACTION_STATUS_TEXT[status] ?? PROJECT_UNKNOWN;
}

export function actionStatusColor(status: null | string | undefined): string {
  return ACTION_STATUS_COLOR[status ?? ''] ?? 'default';
}

/** 历史缺失标记（BR-PROD-03：不伪造 DONE，门禁视为已满足）。 */
const HISTORY_MARK_TEXT: Record<string, string> = {
  HISTORICAL_MISSING: '历史缺失',
};

export function historyMarkText(value: null | string | undefined): string {
  if (!value) return '';
  return HISTORY_MARK_TEXT[value] ?? value;
}

/** 算法分类 FINGERPRINT/FACE/PALM/VEIN/MULTI。 */
const ALGO_TEXT: Record<string, string> = {
  FACE: '人脸',
  FINGERPRINT: '指纹',
  MULTI: '多模态',
  PALM: '掌纹',
  VEIN: '指静脉',
};

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
const PERSON_TYPE_TEXT: Record<string, string> = {
  GROUP_LEADER: '产品组长',
  MARKET_PM: '市场PM',
  RD_PM: '研发PM',
  SUPER_ADMIN: '超级管理员',
};

export function personTypeText(type: null | string | undefined): string {
  if (!type) return PROJECT_UNKNOWN;
  return PERSON_TYPE_TEXT[type] ?? PROJECT_UNKNOWN;
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