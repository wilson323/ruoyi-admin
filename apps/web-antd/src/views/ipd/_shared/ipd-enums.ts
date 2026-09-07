/**
 * IPD 通用展示枚举（前端统一字典）。
 *
 * <p>覆盖：
 * <ul>
 *   <li>ROLE_TEXT — 内部 5 角色中文名</li>
 *   <li>STAGE_TONE — 六阶段 UI 配色</li>
 *   <li>STATUS_TONE — 通用 status 配色</li>
 *   <li>STATE_TONE — 业务状态机节点 tone（来自 ipd-state-machines）</li>
 *   <li>PRIORITY_TEXT — 优先级 3 档</li>
 *   <li>SEVERITY_TEXT — 严重度 3 档</li>
 * </ul>
 *
 * <p>前端 UI 文案与色彩统一源，组件禁止自行硬编码中文/颜色。
 * 后端枚举值若调整，先改 ipd-state-machines / 本文件，再 grep 替换组件。
 */

import {
  BONUS_STATUS_MACHINE,
  CHANGE_STATUS_MACHINE,
  DELETION_STATUS_MACHINE,
  DEMAND_STATUS_MACHINE,
  GATE_STATUS_MACHINE,
  PROJECT_STATUS_MACHINE,
  stateLabel,
  stateTone,
} from './ipd-state-machines';

/** 内部 5 角色中文名（含 MARKET_PM/RD_PM/GROUP_LEADER/SUPER_ADMIN/INTERNAL）。 */
export const ROLE_TEXT: Record<string, string> = {
  GROUP_LEADER: '产品组长',
  INTERNAL: '内部成员',
  MARKET_PM: '市场PM',
  RD_PM: '研发PM',
  SUPER_ADMIN: '超级管理员',
};

/** 角色中文名（未知值返回 '未知角色'）。 */
export function roleText(role: null | string | undefined, fallback = '未知角色'): string {
  if (!role) return fallback;
  return ROLE_TEXT[role] ?? fallback;
}

/** 六阶段 UI 配色。 */
export const STAGE_TONE: Record<string, string> = {
  CONCEPT: 'default',
  DEV: 'processing',
  LAUNCH: 'success',
  LIFECYCLE: 'default',
  PLAN: 'warning',
  VALID: 'warning',
};

/** 通用 status 配色（兜底）。 */
export const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'processing',
  APPROVED: 'success',
  ARCHIVED: 'default',
  CANCELLED: 'default',
  CLOSED: 'default',
  CONFIRMED: 'processing',
  DISABLED: 'default',
  DISTRIBUTED: 'success',
  DRAFT: 'default',
  EXPIRED: 'warning',
  FAILED: 'error',
  IN_PROGRESS: 'warning',
  PENDING: 'warning',
  REJECTED: 'error',
  SELECTED: 'success',
  SUSPENDED: 'warning',
};

/** 优先级 3 档文案。 */
export const PRIORITY_TEXT: Record<string, string> = {
  HIGH: '高',
  LOW: '低',
  NORMAL: '中',
};

export const PRIORITY_TONE: Record<string, string> = {
  HIGH: 'error',
  LOW: 'default',
  NORMAL: 'processing',
};

export function priorityText(priority: null | string | undefined, fallback = '待补充'): string {
  if (!priority) return fallback;
  return PRIORITY_TEXT[priority] ?? fallback;
}

export function priorityTone(priority: null | string | undefined, fallback = 'default'): string {
  if (!priority) return fallback;
  return PRIORITY_TONE[priority] ?? fallback;
}

/** 严重度 3 档文案（负反馈执行使用）。 */
export const SEVERITY_TEXT: Record<string, string> = {
  CRITICAL: '严重',
  MAJOR: '主要',
  MINOR: '轻微',
};

export const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: 'red',
  MAJOR: 'orange',
  MINOR: 'gold',
};

export function severityText(severity: null | string | undefined, fallback = '待补充'): string {
  if (!severity) return fallback;
  return SEVERITY_TEXT[severity] ?? fallback;
}

export function severityTone(severity: null | string | undefined, fallback = 'default'): string {
  if (!severity) return fallback;
  return SEVERITY_TONE[severity] ?? fallback;
}

// ============ 业务状态机导出（统一查表） ============
/** 项目状态中文：stateLabel(PROJECT_STATUS_MACHINE, code)。 */
export const projectStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(PROJECT_STATUS_MACHINE, code, fallback);

export const projectStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(PROJECT_STATUS_MACHINE, code, fallback);

/** 需求状态中文。 */
export const demandStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(DEMAND_STATUS_MACHINE, code, fallback);

export const demandStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(DEMAND_STATUS_MACHINE, code, fallback);

/** 奖金池状态中文。 */
export const bonusStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(BONUS_STATUS_MACHINE, code, fallback);

export const bonusStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(BONUS_STATUS_MACHINE, code, fallback);

/** 删除申请状态中文。 */
export const deletionStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(DELETION_STATUS_MACHINE, code, fallback);

export const deletionStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(DELETION_STATUS_MACHINE, code, fallback);

/** Gate 评审状态中文。 */
export const gateStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(GATE_STATUS_MACHINE, code, fallback);

export const gateStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(GATE_STATUS_MACHINE, code, fallback);

/** 需求变更状态中文。 */
export const changeStateLabel = (code: null | string | undefined, fallback?: string) =>
  stateLabel(CHANGE_STATUS_MACHINE, code, fallback);

export const changeStateTone = (code: null | string | undefined, fallback?: string) =>
  stateTone(CHANGE_STATUS_MACHINE, code, fallback);
