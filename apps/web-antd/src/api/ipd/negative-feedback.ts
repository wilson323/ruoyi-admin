/**
 * 负反馈接口（页36 负反馈执行；P3-8.1/8.2；AC-INC-36b~40；BR-INC-10）。
 *
 * 真值：NegativeFeedbackController（/api/v1/negative-feedback/...）。
 * 规则：主责停发 / 连带减半 / 奖金资格按规则；生效月和恢复时点明确；重复事件不重复扣减。
 * 触发表：需求返工率超标 / 质量事故 / 错过市场窗口（双 PM 共同担责，无主责/连带区分）。
 */
import { ipdGet, ipdPost } from './http';

export type NegativeTrigger = 'DEFECT_REWORK' | 'MISSED_MARKET_WINDOW' | 'QUALITY_INCIDENT';
export type NegativeRole = 'CO_RESPONSIBLE' | 'PRIMARY' | 'SECONDARY';

export interface NegativeFeedback {
  confirmOperatorId?: null | string;
  createTime: string;
  effectiveMonth: string;
  executeMonth: null | string;
  id: string;
  operatorId: string;
  personId: string;
  projectId: string;
  recoveryMonth?: null | string;
  role: NegativeRole;
  trigger: NegativeTrigger;
}

/** 负反馈列表（projectId 可选；personId 可选按 PM 范围）。 */
export function listNegativeFeedback(opts?: { personId?: string; projectId?: string }): Promise<NegativeFeedback[]> {
  const params: Record<string, string> = {};
  if (opts?.projectId) params.projectId = opts.projectId;
  if (opts?.personId) params.personId = opts.personId;
  return ipdGet<NegativeFeedback[]>('/negative-feedback/list', Object.keys(params).length ? params : undefined);
}

/** 创建负反馈记录（仅超管 / 产品组长；权限码 ipd:incentive:execute）。 */
export function createNegativeFeedback(req: Omit<NegativeFeedback, 'confirmOperatorId' | 'createTime' | 'executeMonth' | 'id' | 'recoveryMonth'>): Promise<NegativeFeedback> {
  return ipdPost<NegativeFeedback>('/negative-feedback/create', req);
}
