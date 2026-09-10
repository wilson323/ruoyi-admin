/**
 * 负反馈接口（页36 负反馈执行；P3-8.1/8.2；AC-INC-36b~40；BR-INC-10）。
 *
 * 真值：NegativeFeedbackController（/api/v1/negative-feedbacks）。
 *
 * ✅ 2026-09-08 契约对齐（全局梳理）：原 `/list`、`/create` 为臆造路径——
 *   GET /list 会被后端 `GET /{id}` 路由捕获，"list" 转 Long 失败 → 500/90001
 *   （16039 日志 MethodArgumentTypeMismatchException 实证）。现对齐后端真端点：
 *   - GET  /api/v1/negative-feedbacks?projectId=&status=  — 项目下状态过滤（projectId 必填）
 *   - POST /api/v1/negative-feedbacks                     — DRAFT 录入（operator 由会话推导）
 *
 * 触发表（BR-INC-10，服务端自动推导主责/连带与执行动作，不由前端指定）：
 *   - REWORK_EXCEEDED 需求返工率超标：市场 PM 停发 + 研发 PM 减半
 *   - QUALITY_ACCIDENT 质量事故：研发 PM 停发 + 市场 PM 减半
 *   - SPEC_PILE_COPY 参数堆砌/对标抄袭：研发 PM 停发 + 市场 PM 减半
 *   - MISSED_MARKET_WINDOW 错过市场窗口：双 PM 共同停发（无主次）
 * 重复事件不重复扣减；生效月（triggerMonth）与恢复月（recoveryMonth）明确。
 */
import { ipdGet, ipdPost, ipdPut } from './http';

/** 触发情形（NegativeFeedbackCreateReq @Pattern 四枚举）。 */
export type NegativeTriggerType =
  | 'MISSED_MARKET_WINDOW'
  | 'QUALITY_ACCIDENT'
  | 'REWORK_EXCEEDED'
  | 'SPEC_PILE_COPY';

/** 状态机（NegativeFeedbackService 常量）：DRAFT → PENDING_DECISION → EXECUTED / REJECTED；EXECUTED → LIFTED。 */
export type NegativeStatus =
  | 'DRAFT'
  | 'EXECUTED'
  | 'LIFTED'
  | 'PENDING_DECISION'
  | 'REJECTED';

/** 执行动作：停发 / 减半（服务端按 triggerType 推导，BR-INC-10）。 */
export type NegativeExecution = 'HALVE_ALLOWANCE' | 'STOP_ALLOWANCE';

/** NegativeFeedbackView（21 字段，NegativeFeedbackService.toView 真值）。 */
export interface NegativeFeedback {
  id: null | number | string;
  projectId: null | number | string;
  triggerType: null | NegativeTriggerType | string;
  /** 主责角色（MARKET_PM / RD_PM / BOTH；服务端推导）。 */
  mainRole: null | string;
  mainPersonId: null | number | string;
  mainExecution: null | NegativeExecution | string;
  /** 连带角色（MISSED_MARKET_WINDOW 双 PM 共同担责时为空）。 */
  relatedRole: null | string;
  relatedPersonId: null | number | string;
  relatedExecution: null | NegativeExecution | string;
  /** 是否取消奖金资格。 */
  bonusDisqualify: null | boolean;
  /** 贡献度系数降低（默认 -0.50；BR-INC-10 贡献度系数联动）。 */
  tierDelta: null | number | string;
  /** 触发月份 YYYY-MM（录入必填）。 */
  triggerMonth: null | string;
  /** 恢复月份 YYYY-MM（可选）。 */
  recoveryMonth: null | string;
  triggerEvidence: null | string;
  status: null | NegativeStatus | string;
  triggeredBy: null | number | string;
  decidedBy: null | number | string;
  decidedAt: null | string;
  liftedBy: null | number | string;
  liftedAt: null | string;
  decisionComment: null | string;
}

/**
 * 负反馈列表（projectId 必填；status 可选过滤 5 态）。
 *
 * ✅ `GET /api/v1/negative-feedbacks`（NegativeFeedbackService.listByProject，按 createTime 倒序）。
 * 权限：ipd:incentive:negative-feedback:query；后端另有项目可读性校验（Bug#4）。
 */
export function listNegativeFeedback(
  projectId: string,
  status?: NegativeStatus | string,
): Promise<NegativeFeedback[]> {
  return ipdGet<NegativeFeedback[]>(
    '/negative-feedbacks',
    status ? { projectId, status } : { projectId },
  );
}

/**
 * 录入负反馈 DRAFT（主责/连带映射与执行动作由 triggerType 服务端推导）。
 *
 * ✅ `POST /api/v1/negative-feedbacks`（NegativeFeedbackCreateReq；@Valid 400 拒绝非法枚举/月份）。
 */
export function createNegativeFeedback(req: {
  projectId: string;
  triggerEvidence?: string;
  triggerMonth: string;
  triggerType: NegativeTriggerType;
  recoveryMonth?: string;
}): Promise<NegativeFeedback> {
  return ipdPost<NegativeFeedback>('/negative-feedbacks', req);
}

// ---------- P0-5 补齐：状态机五端点（后端 NegativeFeedbackController L48-94） ----------

/** 认定/解除请求体（NegativeFeedbackDecisionReq：decision + 可选说明）。 */
export interface NegativeDecisionBody {
  comment?: null | string;
  /** APPROVE=认定执行扣减；REJECT=驳回；LIFT=解除恢复（仅 lift 端点）。 */
  decision: 'APPROVE' | 'LIFT' | 'REJECT';
}

/** 提交认定 DRAFT → PENDING_DECISION（权限 ipd:incentive:negative-feedback:create）。 */
export function submitNegativeFeedback(id: string): Promise<NegativeFeedback> {
  return ipdPut<NegativeFeedback>(`/negative-feedbacks/${encodeURIComponent(id)}/submit`);
}

/** 组长认定 PENDING_DECISION → EXECUTED / REJECTED（requireLeaderOrAdmin）。 */
export function decideNegativeFeedback(
  id: string,
  decision: 'APPROVE' | 'REJECT',
  comment?: null | string,
): Promise<NegativeFeedback> {
  return ipdPut<NegativeFeedback>(`/negative-feedbacks/${encodeURIComponent(id)}/decide`, {
    comment: comment ?? null,
    decision,
  } satisfies NegativeDecisionBody);
}

/** 解除 EXECUTED → LIFTED（恢复津贴+奖金资格；body 可省略，后端默认 LIFT）。 */
export function liftNegativeFeedback(id: string, comment?: null | string): Promise<NegativeFeedback> {
  return ipdPut<NegativeFeedback>(`/negative-feedbacks/${encodeURIComponent(id)}/lift`, {
    comment: comment ?? null,
    decision: 'LIFT',
  } satisfies NegativeDecisionBody);
}

/** 详情（GET /{id}；含项目可读性校验）。 */
export function getNegativeFeedback(id: string): Promise<NegativeFeedback> {
  return ipdGet<NegativeFeedback>(`/negative-feedbacks/${encodeURIComponent(id)}`);
}

/** 当前生效（GET /by-project/{projectId}/effective：EXECUTED + 已到执行期的恢复预告）。 */
export function listEffectiveNegativeFeedbacks(projectId: string): Promise<NegativeFeedback[]> {
  return ipdGet<NegativeFeedback[]>(
    `/negative-feedbacks/by-project/${encodeURIComponent(projectId)}/effective`,
  );
}
