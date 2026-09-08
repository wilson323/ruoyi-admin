/**
 * 招标组队域展示辅助（状态/方式中文映射、应标说明组装与校验）。
 *
 * 状态/方式/应标状态的中文标签与配色已迁入 `_shared/ipd-state-machines.ts`（BID_STATUS_MACHINE /
 * BID_RESPONSE_STATUS_MACHINE）与 `_shared/ipd-enums.ts`（BID_MODE_TEXT），本文件只保留：
 * - view 层友好接口（兜底「待补充」）；
 * - bidTimeText 时间归一；
 * - 应标字段组装与校验契约（D-3~D-5）。
 *
 * 真值来源：
 * - 状态机与术语：docs/开发说明/spec/_公共规范.md（G-06：未知值显示「待补充」，禁止绝对化文案）；
 * - 应标字段规则：spec batch-02 页21 + 后端 BidResponseService（solution_summary 映射列 response_note，40-500 字）。
 */
import { formatDateTime } from '../_shared/format';
import type { BidMode } from '../../../api/ipd/bid';
import {
  BID_MODE_TEXT,
  bidResponseStatusLabel,
  bidResponseStatusTone,
  bidStatusLabel,
  bidStatusTone,
} from '../_shared/ipd-enums';

/** G-06：未知值一律显示「待补充」，不留空白。 */
export const BID_UNKNOWN = '待补充';

export function bidStatusText(status: null | string | undefined): string {
  return bidStatusLabel(status, BID_UNKNOWN);
}

export function bidStatusColor(status: null | string | undefined): string {
  return bidStatusTone(status);
}

export function bidModeText(mode: null | BidMode | undefined): string {
  if (!mode) return BID_UNKNOWN;
  return BID_MODE_TEXT[mode] ?? BID_UNKNOWN;
}

export function bidResponseStatusText(status: null | string | undefined): string {
  return bidResponseStatusLabel(status, BID_UNKNOWN);
}

export function bidResponseStatusColor(status: null | string | undefined): string {
  return bidResponseStatusTone(status);
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
