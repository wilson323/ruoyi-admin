/**
 * 招标组队域展示辅助（状态/方式中文映射、应标说明组装与校验）。
 *
 * 真值来源：
 * - 状态机与术语：docs/开发说明/spec/_公共规范.md（G-06：未知值显示「待补充」，禁止绝对化文案）；
 * - 应标字段规则：spec batch-02 页21 + 后端 BidResponseService（solution_summary 映射列 response_note，40-500 字）。
 */
import { formatDateTime } from '../_shared/format';
import type { BidMode } from '../../../api/ipd/bid';

/** G-06：未知值一律显示「待补充」，不留空白。 */
export const BID_UNKNOWN = '待补充';

const BID_STATUS_TEXT: Record<string, string> = {
  CLOSED: '已关闭',
  EXPIRED: '已过期',
  OPEN: '招标中',
  SELECTED: '已遴选',
};

const BID_STATUS_COLOR: Record<string, string> = {
  CLOSED: 'default',
  EXPIRED: 'warning',
  OPEN: 'processing',
  SELECTED: 'success',
};

const BID_MODE_TEXT: Record<string, string> = {
  ONE_TO_ONE: '定向邀请',
  PUBLIC: '公开征集',
};

const RESPONSE_STATUS_TEXT: Record<string, string> = {
  ACCEPTED: '已中标',
  PENDING: '已应标（待遴选）',
  REJECTED: '已落选',
  WITHDRAWN: '已撤回',
};

const RESPONSE_STATUS_COLOR: Record<string, string> = {
  ACCEPTED: 'success',
  PENDING: 'processing',
  REJECTED: 'default',
  WITHDRAWN: 'default',
};

export function bidStatusText(status: null | string | undefined): string {
  if (!status) return BID_UNKNOWN;
  return BID_STATUS_TEXT[status] ?? BID_UNKNOWN;
}

export function bidStatusColor(status: null | string | undefined): string {
  return BID_STATUS_COLOR[status ?? ''] ?? 'default';
}

export function bidModeText(mode: null | BidMode | undefined): string {
  if (!mode) return BID_UNKNOWN;
  return BID_MODE_TEXT[mode] ?? BID_UNKNOWN;
}

export function bidResponseStatusText(status: null | string | undefined): string {
  if (!status) return BID_UNKNOWN;
  return RESPONSE_STATUS_TEXT[status] ?? BID_UNKNOWN;
}

export function bidResponseStatusColor(status: null | string | undefined): string {
  return RESPONSE_STATUS_COLOR[status ?? ''] ?? 'default';
}

/**
 * 招标域时间展示。后端 /api/v1 链路全局 date-format 未生效（R8-P0-11 先例），
 * 未标注 @JsonFormat 的 Date 字段可能以毫秒时间戳输出，这里统一兼容：
 * 'yyyy-MM-dd HH:mm:ss' 字符串先归一为 ISO 形式再交给全站 formatDateTime。
 */
export function bidTimeText(value: null | number | string | undefined): string {
  if (typeof value === 'string' && value.includes(' ')) {
    return formatDateTime(value.replace(' ', 'T'));
  }
  return formatDateTime(value);
}

export interface RespondFormInput {
  /** 方案摘要（spec 页21 solution_summary，≥40 字） */
  plan: string;
  /** 预计周期（天，1-365，默认 90） */
  estimatedDays: null | number;
  /** 资源投入（1-200 字） */
  resourceCommitment: string;
  /** 主要风险（≥20 字） */
  majorRisks: string;
}

/** 应标字段错误（key 与 RespondFormInput 对齐，noteTotal 为拼接后总长错误）。 */
export type RespondFormErrors = Partial<Record<'estimatedDays' | 'majorRisks' | 'noteTotal' | 'plan' | 'resourceCommitment', string>>;

/** 后端对应标说明（response_note）的硬校验边界，BidResponseService#SOLUTION_SUMMARY_MIN_CHARS=40、上限 500。 */
export const RESPONSE_NOTE_MIN = 40;
export const RESPONSE_NOTE_MAX = 500;

/**
 * 将 spec 页21 的四个应标字段拼接为后端 response_note（契约 D-3~D-5 过渡方案：
 * 预计周期/资源投入/主要风险暂无独立通道，以标注行拼入说明文本）。
 */
export function composeResponseNote(input: RespondFormInput): string {
  const lines = [`【方案摘要】${input.plan.trim()}`];
  if (input.estimatedDays !== null && input.estimatedDays !== undefined) {
    lines.push(`【预计周期】${input.estimatedDays} 天`);
  }
  const resource = input.resourceCommitment.trim();
  if (resource) lines.push(`【资源投入】${resource}`);
  const risks = input.majorRisks.trim();
  if (risks) lines.push(`【主要风险】${risks}`);
  return lines.join('\n');
}

/** spec 页21 字段校验 + 后端 40-500 字总长校验（服务端仍是权威，此处仅提前拦截）。 */
export function validateRespondForm(input: RespondFormInput): RespondFormErrors {
  const errors: RespondFormErrors = {};
  const plan = input.plan.trim();
  if (plan.length < RESPONSE_NOTE_MIN) {
    errors.plan = `方案摘要不少于 ${RESPONSE_NOTE_MIN} 字，当前 ${plan.length} 字`;
  }
  const days = input.estimatedDays;
  if (days === null || days === undefined || !Number.isInteger(days) || days < 1 || days > 365) {
    errors.estimatedDays = '预计周期须为 1-365 的整数天';
  }
  const resource = input.resourceCommitment.trim();
  if (resource.length < 1 || resource.length > 200) {
    errors.resourceCommitment = '资源投入须为 1-200 字';
  }
  const risks = input.majorRisks.trim();
  if (risks.length < 20) {
    errors.majorRisks = `主要风险不少于 20 字，当前 ${risks.length} 字`;
  }
  const note = composeResponseNote(input);
  if (note.length > RESPONSE_NOTE_MAX) {
    errors.noteTotal = `拼接后应标说明 ${note.length} 字，超出后端 ${RESPONSE_NOTE_MAX} 字上限，请精简方案摘要等字段`;
  }
  return errors;
}
